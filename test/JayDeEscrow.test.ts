import { expect } from "chai";
import { ethers } from "hardhat";
import { JayDeToken, JayDeEscrow } from "../typechain-types";

describe("JayDeEscrow", function () {
  let token: JayDeToken;
  let escrow: JayDeEscrow;
  let owner: any;
  let buyer: any;
  let seller: any;
  let feeRecipient: any;
  let stranger: any;

  const TRADE_AMOUNT = ethers.parseEther("1000");
  const FEE_BPS = 250n;
  const BPS_DENOM = 10_000n;

  beforeEach(async function () {
    [owner, buyer, seller, feeRecipient, stranger] = await ethers.getSigners();

    const JayDeToken = await ethers.getContractFactory("JayDeToken");
    token = await JayDeToken.deploy(owner.address);

    const JayDeEscrow = await ethers.getContractFactory("JayDeEscrow");
    escrow = await JayDeEscrow.deploy(
      await token.getAddress(),
      feeRecipient.address,
      owner.address
    );

    // Fund buyer with tokens and approve escrow
    await token.transfer(buyer.address, ethers.parseEther("10000"));
    await token.connect(buyer).approve(await escrow.getAddress(), ethers.MaxUint256);
  });

  // ─── Happy Path ──────────────────────────────────────────────────────────────

  describe("Happy path", function () {
    it("buyer can create a trade and tokens are locked in escrow", async function () {
      const escrowAddress = await escrow.getAddress();
      const buyerBefore = await token.balanceOf(buyer.address);

      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);

      expect(await token.balanceOf(escrowAddress)).to.equal(TRADE_AMOUNT);
      expect(await token.balanceOf(buyer.address)).to.equal(buyerBefore - TRADE_AMOUNT);

      const trade = await escrow.trades(1);
      expect(trade.buyer).to.equal(buyer.address);
      expect(trade.seller).to.equal(seller.address);
      expect(trade.amount).to.equal(TRADE_AMOUNT);
      expect(trade.status).to.equal(0); // Status.OPEN
    });

    it("buyer completing trade pays seller minus fee and pays fee recipient", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);

      const sellerBefore = await token.balanceOf(seller.address);
      const feeBefore = await token.balanceOf(feeRecipient.address);

      await escrow.connect(buyer).completeTrade(1);

      const expectedFee = (TRADE_AMOUNT * FEE_BPS) / BPS_DENOM;
      const expectedPayout = TRADE_AMOUNT - expectedFee;

      expect(await token.balanceOf(seller.address)).to.equal(sellerBefore + expectedPayout);
      expect(await token.balanceOf(feeRecipient.address)).to.equal(feeBefore + expectedFee);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    });

    it("completed trade status is set to COMPLETED", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);
      await escrow.connect(buyer).completeTrade(1);

      const trade = await escrow.trades(1);
      expect(trade.status).to.equal(1); // Status.COMPLETED
    });

    it("emits TradeCreated and TradeCompleted events", async function () {
      await expect(escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT))
        .to.emit(escrow, "TradeCreated")
        .withArgs(1n, buyer.address, seller.address, TRADE_AMOUNT);

      await expect(escrow.connect(buyer).completeTrade(1))
        .to.emit(escrow, "TradeCompleted")
        .withArgs(1n);
    });

    it("fee math is exact at 2.5% on 1000 JAYDE", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);

      const sellerBefore = await token.balanceOf(seller.address);
      await escrow.connect(buyer).completeTrade(1);

      // 2.5% of 1000 = 25 JAYDE fee, 975 JAYDE to seller
      expect(await token.balanceOf(feeRecipient.address)).to.equal(ethers.parseEther("25"));
      expect(await token.balanceOf(seller.address)).to.equal(sellerBefore + ethers.parseEther("975"));
    });

    it("tradeCount increments with each new trade", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);
      expect(await escrow.tradeCount()).to.equal(2n);
    });
  });

  // ─── Refund ───────────────────────────────────────────────────────────────────

  describe("Refund", function () {
    it("buyer gets full amount back after refund", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);
      const buyerBefore = await token.balanceOf(buyer.address);

      await escrow.connect(buyer).refundTrade(1);

      expect(await token.balanceOf(buyer.address)).to.equal(buyerBefore + TRADE_AMOUNT);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    });

    it("refund sets trade status to REFUNDED", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);
      await escrow.connect(buyer).refundTrade(1);

      const trade = await escrow.trades(1);
      expect(trade.status).to.equal(2); // Status.REFUNDED
    });

    // [SEC-C1] owner bypass removed — direct owner call would send tokens to the caller's
    //           proxy address without updating any purchase.released flag, locking funds.
    it("owner cannot directly refund an open trade — only the buyer (proxy) may call refundTrade", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);
      await expect(escrow.connect(owner).refundTrade(1))
        .to.be.revertedWith("Not buyer");
    });

    it("emits TradeRefunded event", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);

      await expect(escrow.connect(buyer).refundTrade(1))
        .to.emit(escrow, "TradeRefunded")
        .withArgs(1n);
    });

    it("cannot refund an already completed trade", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);
      await escrow.connect(buyer).completeTrade(1);

      await expect(escrow.connect(buyer).refundTrade(1))
        .to.be.revertedWith("Cannot refund");
    });

    it("cannot complete a refunded trade", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);
      await escrow.connect(buyer).refundTrade(1);

      // [SEC-H2] error message updated: completeTrade now accepts OPEN or DISPUTED
      await expect(escrow.connect(buyer).completeTrade(1))
        .to.be.revertedWith("Trade not open or disputed");
    });
  });

  // ─── Dispute Flow ─────────────────────────────────────────────────────────────

  describe("Dispute flow", function () {
    it("seller can dispute an open trade", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);

      await expect(escrow.connect(seller).disputeTrade(1))
        .to.emit(escrow, "TradeDisputed")
        .withArgs(1n);

      const trade = await escrow.trades(1);
      expect(trade.status).to.equal(3); // Status.DISPUTED
    });

    it("buyer can also dispute an open trade", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);
      await escrow.connect(buyer).disputeTrade(1);

      const trade = await escrow.trades(1);
      expect(trade.status).to.equal(3); // Status.DISPUTED
    });

    // [SEC-C1] owner bypass removed — buyer (proxy) must call refundTrade directly.
    it("buyer can refund a disputed trade — owner cannot bypass refundTrade directly", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);
      await escrow.connect(seller).disputeTrade(1);

      // Owner cannot shortcut
      await expect(escrow.connect(owner).refundTrade(1))
        .to.be.revertedWith("Not buyer");

      // Buyer (the legitimate caller) can still refund a DISPUTED trade
      const buyerBefore = await token.balanceOf(buyer.address);
      await escrow.connect(buyer).refundTrade(1);
      expect(await token.balanceOf(buyer.address)).to.equal(buyerBefore + TRADE_AMOUNT);
      expect((await escrow.trades(1)).status).to.equal(2); // Status.REFUNDED
    });

    // [SEC-H2] completeTrade now accepts DISPUTED status so resolveDisputeForSeller works.
    it("buyer can complete a disputed trade — enables seller-favoured dispute resolution", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);
      await escrow.connect(seller).disputeTrade(1);

      const sellerBefore = await token.balanceOf(seller.address);
      await escrow.connect(buyer).completeTrade(1);

      const expectedFee    = (TRADE_AMOUNT * FEE_BPS) / BPS_DENOM;
      const expectedPayout = TRADE_AMOUNT - expectedFee;
      expect(await token.balanceOf(seller.address)).to.equal(sellerBefore + expectedPayout);
      expect((await escrow.trades(1)).status).to.equal(1); // Status.COMPLETED
    });

    it("cannot dispute an already completed trade", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);
      await escrow.connect(buyer).completeTrade(1);

      await expect(escrow.connect(seller).disputeTrade(1))
        .to.be.revertedWith("Trade not open");
    });
  });

  // ─── Access Control ───────────────────────────────────────────────────────────

  describe("Access control", function () {
    it("non-buyer cannot complete a trade", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);

      await expect(escrow.connect(seller).completeTrade(1))
        .to.be.revertedWith("Not buyer");

      await expect(escrow.connect(stranger).completeTrade(1))
        .to.be.revertedWith("Not buyer");
    });

    it("non-party cannot dispute a trade", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);

      await expect(escrow.connect(stranger).disputeTrade(1))
        .to.be.revertedWith("Not a party");
    });

    // [SEC-C1] error message updated: only "Not buyer" now — owner bypass was removed
    it("non-buyer cannot refund a trade — seller and stranger both revert", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);

      await expect(escrow.connect(seller).refundTrade(1))
        .to.be.revertedWith("Not buyer");

      await expect(escrow.connect(stranger).refundTrade(1))
        .to.be.revertedWith("Not buyer");
    });

    it("non-owner cannot change feeBps", async function () {
      await expect(escrow.connect(buyer).setFeeBps(100))
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("non-owner cannot change feeRecipient", async function () {
      await expect(escrow.connect(buyer).setFeeRecipient(stranger.address))
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("owner cannot set fee above 10% (1000 bps)", async function () {
      await expect(escrow.connect(owner).setFeeBps(1001))
        .to.be.revertedWith("Fee too high");
    });

    it("owner can set fee up to exactly 10% (1000 bps)", async function () {
      await escrow.connect(owner).setFeeBps(1000);
      expect(await escrow.feeBps()).to.equal(1000n);
    });

    it("owner can update fee recipient", async function () {
      await escrow.connect(owner).setFeeRecipient(stranger.address);
      expect(await escrow.feeRecipient()).to.equal(stranger.address);
    });

    it("owner cannot set fee recipient to zero address", async function () {
      await expect(escrow.connect(owner).setFeeRecipient(ethers.ZeroAddress))
        .to.be.revertedWith("Zero address");
    });
  });

  // ─── Edge Cases ───────────────────────────────────────────────────────────────

  describe("Edge cases", function () {
    it("cannot create trade with amount 0", async function () {
      await expect(escrow.connect(buyer).createTrade(seller.address, 0n))
        .to.be.revertedWith("Amount must be > 0");
    });

    it("cannot create trade with self as seller", async function () {
      await expect(escrow.connect(buyer).createTrade(buyer.address, TRADE_AMOUNT))
        .to.be.revertedWith("Invalid seller");
    });

    it("cannot create trade with zero address as seller", async function () {
      await expect(escrow.connect(buyer).createTrade(ethers.ZeroAddress, TRADE_AMOUNT))
        .to.be.revertedWith("Invalid seller");
    });

    it("creating trade fails if buyer has insufficient token balance", async function () {
      const broke = stranger; // no tokens
      await token.connect(broke).approve(await escrow.getAddress(), ethers.MaxUint256);

      await expect(escrow.connect(broke).createTrade(seller.address, TRADE_AMOUNT))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    it("creating trade fails if buyer has not approved escrow", async function () {
      // Revoke approval
      await token.connect(buyer).approve(await escrow.getAddress(), 0n);

      await expect(escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("fee math rounds down — no token dust left in escrow", async function () {
      // Use an odd amount that won't divide cleanly by 400 (10000/250)
      const oddAmount = ethers.parseEther("1") + 1n; // 1 wei over 1 ETH
      await escrow.connect(buyer).createTrade(seller.address, oddAmount);
      await escrow.connect(buyer).completeTrade(1);

      // Escrow should be empty — dust goes to seller, not trapped
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    });

    it("multiple concurrent trades track independently", async function () {
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);
      await escrow.connect(buyer).createTrade(seller.address, TRADE_AMOUNT);

      // Complete only trade 1
      await escrow.connect(buyer).completeTrade(1);

      expect((await escrow.trades(1)).status).to.equal(1); // COMPLETED
      expect((await escrow.trades(2)).status).to.equal(0); // still OPEN

      // Escrow still holds trade 2's funds
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(TRADE_AMOUNT);
    });
  });
});
