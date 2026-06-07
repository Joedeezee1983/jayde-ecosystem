// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Marketplace escrow for JAYDE token-denominated trades.
contract JayDeEscrow is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable jaydeToken;

    enum Status { OPEN, COMPLETED, REFUNDED, DISPUTED }

    struct Trade {
        address buyer;
        address seller;
        uint256 amount;
        uint256 feeBps;   // [FIX-H1] fee snapshot locked at creation — immune to later setFeeBps changes
        Status  status;
    }

    uint256 public tradeCount;
    mapping(uint256 => Trade) public trades;

    // Fee in basis points (e.g. 250 = 2.5%)
    uint256 public feeBps = 250;
    address public feeRecipient;

    uint256 public constant MAX_FEE_BPS = 1_000; // hard cap: 10%

    event TradeCreated(uint256 indexed tradeId, address indexed buyer, address indexed seller, uint256 amount);
    event TradeCompleted(uint256 indexed tradeId);
    event TradeRefunded(uint256 indexed tradeId);
    event TradeDisputed(uint256 indexed tradeId);
    // [FIX-M4] events for admin actions so changes are auditable on-chain
    event FeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    constructor(address _jaydeToken, address _feeRecipient, address initialOwner)
        Ownable(initialOwner)
    {
        // [FIX-L2] explicit zero-address guards
        require(_jaydeToken    != address(0), "Zero token address");
        require(_feeRecipient  != address(0), "Zero fee recipient");
        jaydeToken   = IERC20(_jaydeToken);
        feeRecipient = _feeRecipient;
    }

    function createTrade(address seller, uint256 amount) external nonReentrant returns (uint256 tradeId) {
        require(amount > 0, "Amount must be > 0");
        require(seller != address(0) && seller != msg.sender, "Invalid seller");

        tradeId = ++tradeCount;
        trades[tradeId] = Trade({
            buyer:  msg.sender,
            seller: seller,
            amount: amount,
            feeBps: feeBps,        // [FIX-H1] snapshot current fee — completeTrade uses this, not global feeBps
            status: Status.OPEN
        });

        jaydeToken.safeTransferFrom(msg.sender, address(this), amount);
        emit TradeCreated(tradeId, msg.sender, seller, amount);
    }

    /// @notice Buyer (or proxy buyer) confirms delivery — releases funds to seller minus fee.
    ///         Also accepts DISPUTED status so the marketplace can resolve in the seller's favour.
    function completeTrade(uint256 tradeId) external nonReentrant {
        Trade storage trade = trades[tradeId];
        require(trade.buyer == msg.sender, "Not buyer");
        // [FIX-H2] accept DISPUTED so resolveDisputeForSeller path works
        require(trade.status == Status.OPEN || trade.status == Status.DISPUTED, "Trade not open or disputed");

        trade.status = Status.COMPLETED;

        // [FIX-H1] use snapshot fee — not the potentially-changed global feeBps
        uint256 fee    = (trade.amount * trade.feeBps) / 10_000;
        uint256 payout = trade.amount - fee;

        if (fee > 0) jaydeToken.safeTransfer(feeRecipient, fee);
        jaydeToken.safeTransfer(trade.seller, payout);

        emit TradeCompleted(tradeId);
    }

    /// @notice Buyer refunds an OPEN or DISPUTED trade back to the buyer address.
    ///
    /// [FIX-C1] Removed the `|| owner() == msg.sender` bypass.
    ///   The original bypass allowed the escrow owner to call refundTrade directly,
    ///   which sends tokens to trade.buyer (the Marketplace proxy), but never updates
    ///   Purchase.released — permanently locking those tokens in the Marketplace.
    ///   The Marketplace's resolveDisputeForBuyer (onlyOwner) is the correct refund path.
    function refundTrade(uint256 tradeId) external nonReentrant {
        Trade storage trade = trades[tradeId];
        require(trade.buyer == msg.sender, "Not buyer");
        require(trade.status == Status.OPEN || trade.status == Status.DISPUTED, "Cannot refund");

        trade.status = Status.REFUNDED;
        jaydeToken.safeTransfer(trade.buyer, trade.amount);

        emit TradeRefunded(tradeId);
    }

    /// @notice Either party may flag a trade as disputed for owner arbitration.
    // [FIX-M1] added nonReentrant — no current external calls, but guards against future changes
    function disputeTrade(uint256 tradeId) external nonReentrant {
        Trade storage trade = trades[tradeId];
        require(trade.buyer == msg.sender || trade.seller == msg.sender, "Not a party");
        require(trade.status == Status.OPEN, "Trade not open");

        trade.status = Status.DISPUTED;
        emit TradeDisputed(tradeId);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────────

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= MAX_FEE_BPS, "Fee too high");
        emit FeeUpdated(feeBps, _feeBps);   // [FIX-M4] emit before write (old value readable)
        feeBps = _feeBps;
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "Zero address");
        emit FeeRecipientUpdated(feeRecipient, _feeRecipient);  // [FIX-M4]
        feeRecipient = _feeRecipient;
    }
}
