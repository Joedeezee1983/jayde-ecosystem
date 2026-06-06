// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IJayDeEscrow {
    function createTrade(address seller, uint256 amount) external returns (uint256 tradeId);
    function completeTrade(uint256 tradeId) external;
    function refundTrade(uint256 tradeId) external;
    function disputeTrade(uint256 tradeId) external;
}

/// @notice On-chain listing registry. The Marketplace acts as the escrow buyer
///         proxy so individual listings stay composable with JayDeEscrow.
contract JayDeMarketplace is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20  public immutable jaydeToken;
    IJayDeEscrow public immutable escrow;

    // ─── Data structures ────────────────────────────────────────────────────────

    struct Listing {
        uint256 id;
        address seller;
        string  title;
        uint256 price;      // in JAYDE (18 decimals)
        string  ipfsHash;   // IPFS CID for image / description
        bool    isActive;
    }

    struct Purchase {
        uint256 listingId;
        address buyer;
        uint256 escrowTradeId;
        bool    released;   // true once completeTrade or refundTrade has been called
    }

    uint256 public listingCount;
    uint256 public purchaseCount;

    mapping(uint256 => Listing)  public listings;
    mapping(uint256 => Purchase) public purchases;

    // ─── Events ─────────────────────────────────────────────────────────────────

    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        string  title,
        uint256 price,
        string  ipfsHash
    );

    event ListingPurchased(
        uint256 indexed listingId,
        uint256 indexed purchaseId,
        address indexed buyer,
        uint256 escrowTradeId
    );

    event ListingDeactivated(uint256 indexed listingId);

    // ─── Constructor ─────────────────────────────────────────────────────────────

    constructor(address _jaydeToken, address _escrow, address initialOwner)
        Ownable(initialOwner)
    {
        jaydeToken = IERC20(_jaydeToken);
        escrow     = IJayDeEscrow(_escrow);
    }

    // ─── Seller actions ──────────────────────────────────────────────────────────

    /// @notice Register a new listing. Caller becomes the seller.
    function createListing(
        string calldata title,
        uint256 price,
        string calldata ipfsHash
    ) external returns (uint256 listingId) {
        require(bytes(title).length > 0,    "Title required");
        require(price > 0,                  "Price must be > 0");
        require(bytes(ipfsHash).length > 0, "IPFS hash required");

        listingId = ++listingCount;
        listings[listingId] = Listing({
            id:       listingId,
            seller:   msg.sender,
            title:    title,
            price:    price,
            ipfsHash: ipfsHash,
            isActive: true
        });

        emit ListingCreated(listingId, msg.sender, title, price, ipfsHash);
    }

    /// @notice Seller can deactivate their own listing at any time.
    function deactivateListing(uint256 listingId) external {
        Listing storage listing = listings[listingId];
        require(listing.seller == msg.sender, "Not seller");
        require(listing.isActive,             "Already inactive");

        listing.isActive = false;
        emit ListingDeactivated(listingId);
    }

    // ─── Buyer actions ───────────────────────────────────────────────────────────

    /// @notice Purchase a listing. Buyer must have approved this contract for
    ///         at least listing.price JAYDE before calling.
    ///
    ///         Flow:
    ///           1. Pull tokens from buyer → this contract
    ///           2. Approve escrow for the exact amount
    ///           3. Marketplace calls escrow.createTrade (marketplace = escrow buyer proxy)
    ///           4. Record purchase so buyer can later call confirmDelivery / requestRefund
    function purchaseListing(uint256 listingId)
        external
        nonReentrant
        returns (uint256 purchaseId)
    {
        Listing storage listing = listings[listingId];
        require(listing.isActive,                   "Listing not active");
        require(listing.seller != msg.sender,        "Seller cannot buy own listing");

        uint256 price = listing.price;

        // Pull tokens from buyer into this contract
        jaydeToken.safeTransferFrom(msg.sender, address(this), price);

        // Approve the escrow to pull them back out
        jaydeToken.forceApprove(address(escrow), price);

        // Create the escrow trade — marketplace is the proxy buyer
        uint256 escrowTradeId = escrow.createTrade(listing.seller, price);

        purchaseId = ++purchaseCount;
        purchases[purchaseId] = Purchase({
            listingId:    listingId,
            buyer:        msg.sender,
            escrowTradeId: escrowTradeId,
            released:     false
        });

        emit ListingPurchased(listingId, purchaseId, msg.sender, escrowTradeId);
    }

    /// @notice Buyer confirms they received the goods — releases funds to seller.
    function confirmDelivery(uint256 purchaseId) external nonReentrant {
        Purchase storage purchase = purchases[purchaseId];
        require(purchase.buyer == msg.sender, "Not buyer");
        require(!purchase.released,           "Already released");

        purchase.released = true;
        escrow.completeTrade(purchase.escrowTradeId);
    }

    /// @notice Buyer requests a refund — returns funds to this contract, then to buyer.
    function requestRefund(uint256 purchaseId) external nonReentrant {
        Purchase storage purchase = purchases[purchaseId];
        require(purchase.buyer == msg.sender, "Not buyer");
        require(!purchase.released,           "Already released");

        purchase.released = true;
        escrow.refundTrade(purchase.escrowTradeId);

        // Escrow returns tokens to this contract (we are the proxy buyer);
        // forward them to the real buyer.
        Listing storage listing = listings[purchase.listingId];
        jaydeToken.safeTransfer(purchase.buyer, listing.price);
    }

    /// @notice Either party can raise a dispute for owner arbitration.
    function disputePurchase(uint256 purchaseId) external {
        Purchase storage purchase = purchases[purchaseId];
        Listing  storage listing  = listings[purchase.listingId];
        require(
            purchase.buyer == msg.sender || listing.seller == msg.sender,
            "Not a party"
        );
        require(!purchase.released, "Already released");

        escrow.disputeTrade(purchase.escrowTradeId);
    }

    /// @notice Owner resolves a dispute in the buyer's favour — refunds buyer.
    function resolveDisputeForBuyer(uint256 purchaseId) external onlyOwner nonReentrant {
        Purchase storage purchase = purchases[purchaseId];
        require(!purchase.released, "Already released");

        purchase.released = true;
        escrow.refundTrade(purchase.escrowTradeId);

        Listing storage listing = listings[purchase.listingId];
        jaydeToken.safeTransfer(purchase.buyer, listing.price);
    }
}
