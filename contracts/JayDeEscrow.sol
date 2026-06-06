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
        Status status;
    }

    uint256 public tradeCount;
    mapping(uint256 => Trade) public trades;

    // Fee in basis points (e.g. 250 = 2.5%)
    uint256 public feeBps = 250;
    address public feeRecipient;

    event TradeCreated(uint256 indexed tradeId, address indexed buyer, address indexed seller, uint256 amount);
    event TradeCompleted(uint256 indexed tradeId);
    event TradeRefunded(uint256 indexed tradeId);
    event TradeDisputed(uint256 indexed tradeId);

    constructor(address _jaydeToken, address _feeRecipient, address initialOwner)
        Ownable(initialOwner)
    {
        jaydeToken = IERC20(_jaydeToken);
        feeRecipient = _feeRecipient;
    }

    function createTrade(address seller, uint256 amount) external nonReentrant returns (uint256 tradeId) {
        require(amount > 0, "Amount must be > 0");
        require(seller != address(0) && seller != msg.sender, "Invalid seller");

        tradeId = ++tradeCount;
        trades[tradeId] = Trade({
            buyer: msg.sender,
            seller: seller,
            amount: amount,
            status: Status.OPEN
        });

        jaydeToken.safeTransferFrom(msg.sender, address(this), amount);
        emit TradeCreated(tradeId, msg.sender, seller, amount);
    }

    function completeTrade(uint256 tradeId) external nonReentrant {
        Trade storage trade = trades[tradeId];
        require(trade.buyer == msg.sender, "Not buyer");
        require(trade.status == Status.OPEN, "Trade not open");

        trade.status = Status.COMPLETED;

        uint256 fee = (trade.amount * feeBps) / 10_000;
        uint256 payout = trade.amount - fee;

        if (fee > 0) jaydeToken.safeTransfer(feeRecipient, fee);
        jaydeToken.safeTransfer(trade.seller, payout);

        emit TradeCompleted(tradeId);
    }

    function refundTrade(uint256 tradeId) external nonReentrant {
        Trade storage trade = trades[tradeId];
        require(trade.buyer == msg.sender || owner() == msg.sender, "Not authorized");
        require(trade.status == Status.OPEN || trade.status == Status.DISPUTED, "Cannot refund");

        trade.status = Status.REFUNDED;
        jaydeToken.safeTransfer(trade.buyer, trade.amount);

        emit TradeRefunded(tradeId);
    }

    function disputeTrade(uint256 tradeId) external {
        Trade storage trade = trades[tradeId];
        require(trade.buyer == msg.sender || trade.seller == msg.sender, "Not a party");
        require(trade.status == Status.OPEN, "Trade not open");

        trade.status = Status.DISPUTED;
        emit TradeDisputed(tradeId);
    }

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 1000, "Fee too high"); // max 10%
        feeBps = _feeBps;
    }

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "Zero address");
        feeRecipient = _feeRecipient;
    }
}
