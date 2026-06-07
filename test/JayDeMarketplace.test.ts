import { expect } from "chai";
import { ethers } from "hardhat";
import { JayDeToken, JayDeEscrow, JayDeMarketplace } from "../typechain-types";

describe("JayDeMarketplace", function () {
  let token: JayDeToken;
  let escrow: JayDeEscrow;
  let marketplace: JayDeMarketplace;
  let owner: any;
  let seller: any;
  let buyer: any;
  let feeRecipient: any;
  let stranger: any;

  const PRICE      = ethers.parseEther("500");
  const TITLE      = "Digital Art #1";
  const IPFS_HASH  = "QmYwAPJzv5CZsnAztV8dH6r5YDPBrqFpJRGmDwwA5DuVAM";
  const FEE_BPS    = 250n;
  const BPS_DENOM  = 10_000n;

  beforeEach(async function () {
    [owner, seller, buyer, feeRecipient, stranger] = await ethers.getSigners();

    const TokenFactory = await ethers.getContractFactory("JayDeToken");
    token = await TokenFactory.deploy(owner.address);

    const EscrowFactory = await ethers.getContractFactory("JayDeEscrow");
    escrow = await EscrowFactory.deploy(
      await token.getAddress(),
      feeRecipient.address,
      owner.address
    );

    const MarketplaceFactory = await ethers.getContractFactory("JayDeMarketplace");
    marketplace = await MarketplaceFactory.deploy(
      await token.getAddress(),
      await escrow.getAddress(),
      owner.address
    );

    // Fund buyer and approve marketplace (buyer approves marketplace, not escrow)
    await token.transfer(buyer.address, ethers.parseEther("10000"));
    await token.connect(buyer).approve(await marketplace.getAddress(), ethers.MaxUint256);
  });

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  async function createDefaultListing() {
    return marketplace.connect(seller).createListing(TITLE, PRICE, IPFS_HASH);
  }

  async function createAndPurchase() {
    await createDefaultListing();
    await marketplace.connect(buyer).purchaseListing(1);
  }

  // ─── Listing creation ─────────────────────────────────────────────────────────

  describe("Listing creation", function () {
    it("stores title, price, ipfsHash, and seller correctly", async function () {
      await createDefaultListing();
      const listing = await marketplace.listings(1);

      expect(listing.id).to.equal(1n);
      expect(listing.seller).to.equal(seller.address);
      expect(listing.title).to.equal(TITLE);
      expect(listing.price).to.equal(PRICE);
      expect(listing.ipfsHash).to.equal(IPFS_HASH);
      expect(listing.isActive).to.equal(true);
    });

    it("listingCount increments with each new listing", async function () {
      await createDefaultListing();
      await marketplace.connect(seller).createListing("Item 2", ethers.parseEther("100"), IPFS_HASH);

      expect(await marketplace.listingCount()).to.equal(2n);
    });

    it("emits ListingCreated with correct arguments", async function () {
      await expect(createDefaultListing())
        .to.emit(marketplace, "ListingCreated")
        .withArgs(1n, seller.address, TITLE, PRICE, IPFS_HASH);
    });

    it("any address can create a listing", async function () {
      await marketplace.connect(buyer).createListing("Buyer listing", PRICE, IPFS_HASH);
      const listing = await marketplace.listings(1);
      expect(listing.seller).to.equal(buyer.address);
    });

    it("reverts with empty title", async function () {
      await expect(marketplace.connect(seller).createListing("", PRICE, IPFS_HASH))
        .to.be.revertedWith("Title required");
    });

    it("reverts with price 0", async function () {
      await expect(marketplace.connect(seller).createListing(TITLE, 0n, IPFS_HASH))
        .to.be.revertedWith("Price must be > 0");
    });

    it("reverts with empty IPFS hash", async function () {
      await expect(marketplace.connect(seller).createListing(TITLE, PRICE, ""))
        .to.be.revertedWith("IPFS hash required");
    });

    // [SEC-M3] string length limits
    it("reverts if title exceeds MAX_TITLE_LENGTH (256 bytes)", async function () {
      const longTitle = "A".repeat(257);
      await expect(marketplace.connect(seller).createListing(longTitle, PRICE, IPFS_HASH))
        .to.be.revertedWith("Title too long");
    });

    it("accepts a title of exactly MAX_TITLE_LENGTH (256 bytes)", async function () {
      const maxTitle = "B".repeat(256);
      await expect(marketplace.connect(seller).createListing(maxTitle, PRICE, IPFS_HASH))
        .to.not.be.reverted;
    });

    it("reverts if IPFS hash exceeds MAX_IPFS_HASH_LENGTH (128 bytes)", async function () {
      const longHash = "Q".repeat(129);
      await expect(marketplace.connect(seller).createListing(TITLE, PRICE, longHash))
        .to.be.revertedWith("IPFS hash too long");
    });

    it("accepts an IPFS hash of exactly MAX_IPFS_HASH_LENGTH (128 bytes)", async function () {
      const maxHash = "Q".repeat(128);
      await expect(marketplace.connect(seller).createListing(TITLE, PRICE, maxHash))
        .to.not.be.reverted;
    });
  });

  // ─── Deactivation ─────────────────────────────────────────────────────────────

  describe("Deactivation", function () {
    beforeEach(createDefaultListing);

    it("seller can deactivate their listing", async function () {
      await marketplace.connect(seller).deactivateListing(1);
      expect((await marketplace.listings(1)).isActive).to.equal(false);
    });

    it("emits ListingDeactivated", async function () {
      await expect(marketplace.connect(seller).deactivateListing(1))
        .to.emit(marketplace, "ListingDeactivated")
        .withArgs(1n);
    });

    it("stranger cannot deactivate a listing", async function () {
      await expect(marketplace.connect(stranger).deactivateListing(1))
        .to.be.revertedWith("Not seller");
    });

    it("buyer cannot deactivate a listing they do not own", async function () {
      await expect(marketplace.connect(buyer).deactivateListing(1))
        .to.be.revertedWith("Not seller");
    });

    it("cannot deactivate an already inactive listing", async function () {
      await marketplace.connect(seller).deactivateListing(1);
      await expect(marketplace.connect(seller).deactivateListing(1))
        .to.be.revertedWith("Already inactive");
    });

    it("cannot purchase an inactive listing", async function () {
      await marketplace.connect(seller).deactivateListing(1);
      await expect(marketplace.connect(buyer).purchaseListing(1))
        .to.be.revertedWith("Listing not active");
    });
  });

  // ─── Purchase flow ────────────────────────────────────────────────────────────

  describe("Purchase flow", function () {
    beforeEach(createDefaultListing);

    it("pulls exact token amount from buyer", async function () {
      const buyerBefore = await token.balanceOf(buyer.address);
      await marketplace.connect(buyer).purchaseListing(1);
      expect(await token.balanceOf(buyer.address)).to.equal(buyerBefore - PRICE);
    });

    it("escrow holds the tokens after purchase", async function () {
      await marketplace.connect(buyer).purchaseListing(1);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(PRICE);
    });

    it("marketplace balance is zero after purchase (proxy, not custodian)", async function () {
      await marketplace.connect(buyer).purchaseListing(1);
      expect(await token.balanceOf(await marketplace.getAddress())).to.equal(0n);
    });

    it("saves purchase record with correct fields", async function () {
      await marketplace.connect(buyer).purchaseListing(1);
      const purchase = await marketplace.purchases(1);

      expect(purchase.listingId).to.equal(1n);
      expect(purchase.buyer).to.equal(buyer.address);
      expect(purchase.escrowTradeId).to.equal(1n);
      expect(purchase.released).to.equal(false);
    });

    it("purchaseCount increments with each purchase", async function () {
      await marketplace.connect(buyer).purchaseListing(1);
      await marketplace.connect(seller).createListing("Item 2", PRICE, IPFS_HASH);
      await token.transfer(stranger.address, PRICE);
      await token.connect(stranger).approve(await marketplace.getAddress(), ethers.MaxUint256);
      await marketplace.connect(stranger).purchaseListing(2);

      expect(await marketplace.purchaseCount()).to.equal(2n);
    });

    it("emits ListingPurchased with correct arguments", async function () {
      await expect(marketplace.connect(buyer).purchaseListing(1))
        .to.emit(marketplace, "ListingPurchased")
        .withArgs(1n, 1n, buyer.address, 1n);
    });

    it("escrow trade records marketplace as proxy buyer", async function () {
      await marketplace.connect(buyer).purchaseListing(1);
      const trade = await escrow.trades(1);
      expect(trade.buyer).to.equal(await marketplace.getAddress());
      expect(trade.seller).to.equal(seller.address);
      expect(trade.amount).to.equal(PRICE);
    });

    it("seller cannot purchase their own listing", async function () {
      await token.transfer(seller.address, PRICE);
      await token.connect(seller).approve(await marketplace.getAddress(), ethers.MaxUint256);
      await expect(marketplace.connect(seller).purchaseListing(1))
        .to.be.revertedWith("Seller cannot buy own listing");
    });

    it("reverts if buyer has not approved the marketplace", async function () {
      await token.connect(buyer).approve(await marketplace.getAddress(), 0n);
      await expect(marketplace.connect(buyer).purchaseListing(1))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("reverts if buyer has insufficient balance", async function () {
      await token.connect(stranger).approve(await marketplace.getAddress(), ethers.MaxUint256);
      await expect(marketplace.connect(stranger).purchaseListing(1))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    // [SEC-C2] single-sale enforcement
    it("purchaseListing deactivates the listing — isActive becomes false", async function () {
      await marketplace.connect(buyer).purchaseListing(1);
      expect((await marketplace.listings(1)).isActive).to.equal(false);
    });

    it("purchaseListing emits ListingDeactivated", async function () {
      await expect(marketplace.connect(buyer).purchaseListing(1))
        .to.emit(marketplace, "ListingDeactivated")
        .withArgs(1n);
    });

    it("cannot purchase the same listing twice — second attempt reverts", async function () {
      await marketplace.connect(buyer).purchaseListing(1);
      // fund a second buyer
      await token.transfer(stranger.address, PRICE);
      await token.connect(stranger).approve(await marketplace.getAddress(), ethers.MaxUint256);
      await expect(marketplace.connect(stranger).purchaseListing(1))
        .to.be.revertedWith("Listing not active");
    });
  });

  // ─── Confirm delivery ─────────────────────────────────────────────────────────

  describe("Confirm delivery", function () {
    beforeEach(createAndPurchase);

    it("seller receives price minus 2.5% fee after buyer confirms delivery", async function () {
      const sellerBefore = await token.balanceOf(seller.address);
      await marketplace.connect(buyer).confirmDelivery(1);

      const expectedFee    = (PRICE * FEE_BPS) / BPS_DENOM;
      const expectedPayout = PRICE - expectedFee;
      expect(await token.balanceOf(seller.address)).to.equal(sellerBefore + expectedPayout);
    });

    it("fee recipient receives the 2.5% fee on confirm", async function () {
      const feeBefore = await token.balanceOf(feeRecipient.address);
      await marketplace.connect(buyer).confirmDelivery(1);

      const expectedFee = (PRICE * FEE_BPS) / BPS_DENOM;
      expect(await token.balanceOf(feeRecipient.address)).to.equal(feeBefore + expectedFee);
    });

    it("escrow drains to zero after confirm", async function () {
      await marketplace.connect(buyer).confirmDelivery(1);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    });

    it("purchase is marked released after confirm", async function () {
      await marketplace.connect(buyer).confirmDelivery(1);
      expect((await marketplace.purchases(1)).released).to.equal(true);
    });

    it("stranger cannot confirm delivery", async function () {
      await expect(marketplace.connect(stranger).confirmDelivery(1))
        .to.be.revertedWith("Not buyer");
    });

    it("seller cannot confirm delivery", async function () {
      await expect(marketplace.connect(seller).confirmDelivery(1))
        .to.be.revertedWith("Not buyer");
    });

    it("cannot confirm delivery twice", async function () {
      await marketplace.connect(buyer).confirmDelivery(1);
      await expect(marketplace.connect(buyer).confirmDelivery(1))
        .to.be.revertedWith("Already released");
    });

    it("cannot request refund after delivery confirmed", async function () {
      await marketplace.connect(buyer).confirmDelivery(1);
      await expect(marketplace.connect(buyer).requestRefund(1))
        .to.be.revertedWith("Already released");
    });
  });

  // ─── Refund flow ──────────────────────────────────────────────────────────────

  describe("Refund flow", function () {
    beforeEach(createAndPurchase);

    it("full token amount returns to real buyer, not marketplace", async function () {
      const buyerBefore = await token.balanceOf(buyer.address);
      await marketplace.connect(buyer).requestRefund(1);
      expect(await token.balanceOf(buyer.address)).to.equal(buyerBefore + PRICE);
    });

    it("marketplace balance is zero after refund — tokens forwarded correctly", async function () {
      await marketplace.connect(buyer).requestRefund(1);
      expect(await token.balanceOf(await marketplace.getAddress())).to.equal(0n);
    });

    it("escrow drains to zero after refund", async function () {
      await marketplace.connect(buyer).requestRefund(1);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    });

    it("purchase is marked released after refund", async function () {
      await marketplace.connect(buyer).requestRefund(1);
      expect((await marketplace.purchases(1)).released).to.equal(true);
    });

    it("stranger cannot request refund", async function () {
      await expect(marketplace.connect(stranger).requestRefund(1))
        .to.be.revertedWith("Not buyer");
    });

    it("seller cannot request refund", async function () {
      await expect(marketplace.connect(seller).requestRefund(1))
        .to.be.revertedWith("Not buyer");
    });

    it("cannot refund twice", async function () {
      await marketplace.connect(buyer).requestRefund(1);
      await expect(marketplace.connect(buyer).requestRefund(1))
        .to.be.revertedWith("Already released");
    });

    it("cannot confirm delivery after refund", async function () {
      await marketplace.connect(buyer).requestRefund(1);
      await expect(marketplace.connect(buyer).confirmDelivery(1))
        .to.be.revertedWith("Already released");
    });
  });

  // ─── Dispute flow ─────────────────────────────────────────────────────────────

  describe("Dispute flow", function () {
    beforeEach(createAndPurchase);

    it("buyer can raise a dispute", async function () {
      await marketplace.connect(buyer).disputePurchase(1);
      const trade = await escrow.trades(1);
      expect(trade.status).to.equal(3); // Status.DISPUTED
    });

    it("seller can raise a dispute", async function () {
      await marketplace.connect(seller).disputePurchase(1);
      const trade = await escrow.trades(1);
      expect(trade.status).to.equal(3); // Status.DISPUTED
    });

    it("stranger cannot raise a dispute", async function () {
      await expect(marketplace.connect(stranger).disputePurchase(1))
        .to.be.revertedWith("Not a party");
    });

    it("cannot dispute an already released purchase", async function () {
      await marketplace.connect(buyer).confirmDelivery(1);
      await expect(marketplace.connect(buyer).disputePurchase(1))
        .to.be.revertedWith("Already released");
    });

    it("owner resolves dispute — full amount returns to real buyer", async function () {
      await marketplace.connect(seller).disputePurchase(1);
      const buyerBefore = await token.balanceOf(buyer.address);

      await marketplace.connect(owner).resolveDisputeForBuyer(1);

      expect(await token.balanceOf(buyer.address)).to.equal(buyerBefore + PRICE);
    });

    it("marketplace balance is zero after owner resolves dispute", async function () {
      await marketplace.connect(seller).disputePurchase(1);
      await marketplace.connect(owner).resolveDisputeForBuyer(1);
      expect(await token.balanceOf(await marketplace.getAddress())).to.equal(0n);
    });

    it("escrow drains to zero after owner resolves dispute", async function () {
      await marketplace.connect(buyer).disputePurchase(1);
      await marketplace.connect(owner).resolveDisputeForBuyer(1);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    });

    it("purchase is marked released after owner resolves dispute", async function () {
      await marketplace.connect(buyer).disputePurchase(1);
      await marketplace.connect(owner).resolveDisputeForBuyer(1);
      expect((await marketplace.purchases(1)).released).to.equal(true);
    });

    it("non-owner cannot resolve a dispute", async function () {
      await marketplace.connect(buyer).disputePurchase(1);
      await expect(marketplace.connect(buyer).resolveDisputeForBuyer(1))
        .to.be.revertedWithCustomError(marketplace, "OwnableUnauthorizedAccount");
      await expect(marketplace.connect(seller).resolveDisputeForBuyer(1))
        .to.be.revertedWithCustomError(marketplace, "OwnableUnauthorizedAccount");
    });

    it("cannot resolve an already released purchase", async function () {
      await marketplace.connect(buyer).requestRefund(1);
      await expect(marketplace.connect(owner).resolveDisputeForBuyer(1))
        .to.be.revertedWith("Already released");
    });

    it("owner can also resolve without a prior disputePurchase call (open trade refund)", async function () {
      // No dispute raised — owner still has authority to refund an open trade
      const buyerBefore = await token.balanceOf(buyer.address);
      await marketplace.connect(owner).resolveDisputeForBuyer(1);
      expect(await token.balanceOf(buyer.address)).to.equal(buyerBefore + PRICE);
    });

    it("resolveDisputeForBuyer emits DisputeResolved with buyerFavored=true", async function () {
      await marketplace.connect(buyer).disputePurchase(1);
      await expect(marketplace.connect(owner).resolveDisputeForBuyer(1))
        .to.emit(marketplace, "DisputeResolved")
        .withArgs(1n, true);
    });

    // [SEC-H2] resolveDisputeForSeller — previously missing, owner could only ever favour buyer

    it("owner resolves dispute in seller's favour — seller receives payout minus fee", async function () {
      await marketplace.connect(buyer).disputePurchase(1);
      const sellerBefore = await token.balanceOf(seller.address);

      await marketplace.connect(owner).resolveDisputeForSeller(1);

      const expectedFee    = (PRICE * FEE_BPS) / BPS_DENOM;
      const expectedPayout = PRICE - expectedFee;
      expect(await token.balanceOf(seller.address)).to.equal(sellerBefore + expectedPayout);
    });

    it("owner resolves dispute in seller's favour — fee recipient receives fee", async function () {
      await marketplace.connect(buyer).disputePurchase(1);
      const feeBefore = await token.balanceOf(feeRecipient.address);

      await marketplace.connect(owner).resolveDisputeForSeller(1);

      const expectedFee = (PRICE * FEE_BPS) / BPS_DENOM;
      expect(await token.balanceOf(feeRecipient.address)).to.equal(feeBefore + expectedFee);
    });

    it("resolveDisputeForSeller marks purchase as released", async function () {
      await marketplace.connect(buyer).disputePurchase(1);
      await marketplace.connect(owner).resolveDisputeForSeller(1);
      expect((await marketplace.purchases(1)).released).to.equal(true);
    });

    it("escrow drains to zero after resolveDisputeForSeller", async function () {
      await marketplace.connect(buyer).disputePurchase(1);
      await marketplace.connect(owner).resolveDisputeForSeller(1);
      expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
    });

    it("resolveDisputeForSeller emits DisputeResolved with buyerFavored=false", async function () {
      await marketplace.connect(buyer).disputePurchase(1);
      await expect(marketplace.connect(owner).resolveDisputeForSeller(1))
        .to.emit(marketplace, "DisputeResolved")
        .withArgs(1n, false);
    });

    it("non-owner cannot call resolveDisputeForSeller", async function () {
      await marketplace.connect(buyer).disputePurchase(1);
      await expect(marketplace.connect(seller).resolveDisputeForSeller(1))
        .to.be.revertedWithCustomError(marketplace, "OwnableUnauthorizedAccount");
      await expect(marketplace.connect(buyer).resolveDisputeForSeller(1))
        .to.be.revertedWithCustomError(marketplace, "OwnableUnauthorizedAccount");
    });

    it("cannot call resolveDisputeForSeller on already released purchase", async function () {
      await marketplace.connect(buyer).confirmDelivery(1);
      await expect(marketplace.connect(owner).resolveDisputeForSeller(1))
        .to.be.revertedWith("Already released");
    });

    it("owner can resolveDisputeForSeller without prior dispute (open trade)", async function () {
      const sellerBefore = await token.balanceOf(seller.address);
      await marketplace.connect(owner).resolveDisputeForSeller(1);
      const expectedPayout = PRICE - (PRICE * FEE_BPS) / BPS_DENOM;
      expect(await token.balanceOf(seller.address)).to.equal(sellerBefore + expectedPayout);
    });
  });

  // ─── Access control (cross-cutting) ──────────────────────────────────────────

  describe("Access control", function () {
    beforeEach(createAndPurchase);

    it("stranger cannot deactivate any listing", async function () {
      await expect(marketplace.connect(stranger).deactivateListing(1))
        .to.be.revertedWith("Not seller");
    });

    it("stranger cannot confirm delivery", async function () {
      await expect(marketplace.connect(stranger).confirmDelivery(1))
        .to.be.revertedWith("Not buyer");
    });

    it("stranger cannot request a refund", async function () {
      await expect(marketplace.connect(stranger).requestRefund(1))
        .to.be.revertedWith("Not buyer");
    });

    it("stranger cannot resolve a dispute", async function () {
      await marketplace.connect(buyer).disputePurchase(1);
      await expect(marketplace.connect(stranger).resolveDisputeForBuyer(1))
        .to.be.revertedWithCustomError(marketplace, "OwnableUnauthorizedAccount");
    });

    it("seller cannot confirm delivery on their own sale", async function () {
      await expect(marketplace.connect(seller).confirmDelivery(1))
        .to.be.revertedWith("Not buyer");
    });

    it("seller cannot request a refund on their own sale", async function () {
      await expect(marketplace.connect(seller).requestRefund(1))
        .to.be.revertedWith("Not buyer");
    });
  });

  // ─── Security ─────────────────────────────────────────────────────────────────

  describe("Security", function () {

    // [SEC-C1] Escrow owner bypass removed — direct refundTrade call would lock tokens in marketplace
    it("escrow owner cannot directly call refundTrade on a marketplace trade — prevents token lockup", async function () {
      await createAndPurchase();
      // owner is also the escrow owner; calling refundTrade directly would send tokens
      // to the Marketplace (trade.buyer) with no purchase.released update → tokens locked forever.
      // After the fix, only trade.buyer (marketplace) may call refundTrade.
      await expect(escrow.connect(owner).refundTrade(1))
        .to.be.revertedWith("Not buyer");
    });

    it("stranger also cannot directly call refundTrade on escrow", async function () {
      await createAndPurchase();
      await expect(escrow.connect(stranger).refundTrade(1))
        .to.be.revertedWith("Not buyer");
    });

    // [SEC-H1] Fee snapshotted at trade creation — mid-trade fee change has no effect
    it("changing feeBps after purchase does not affect seller payout on confirmDelivery", async function () {
      await createDefaultListing();
      await marketplace.connect(buyer).purchaseListing(1);

      // Owner doubles the fee after the trade is already open
      await escrow.connect(owner).setFeeBps(500); // 5%

      const sellerBefore = await token.balanceOf(seller.address);
      await marketplace.connect(buyer).confirmDelivery(1);

      // Payout must use the snapshotted 2.5%, not the new 5%
      const expectedFee    = (PRICE * 250n) / 10_000n;
      const expectedPayout = PRICE - expectedFee;
      expect(await token.balanceOf(seller.address)).to.equal(sellerBefore + expectedPayout);
    });

    it("snapshotted fee is also used when owner resolves dispute for seller", async function () {
      await createDefaultListing();
      await marketplace.connect(buyer).purchaseListing(1);
      await marketplace.connect(buyer).disputePurchase(1);

      // Owner changes fee after the trade is disputed
      await escrow.connect(owner).setFeeBps(800); // 8%

      const sellerBefore = await token.balanceOf(seller.address);
      await marketplace.connect(owner).resolveDisputeForSeller(1);

      // Must still use 2.5% snapshot
      const expectedFee    = (PRICE * 250n) / 10_000n;
      const expectedPayout = PRICE - expectedFee;
      expect(await token.balanceOf(seller.address)).to.equal(sellerBefore + expectedPayout);
    });

    // [SEC-M4] Admin events
    it("setFeeBps emits FeeUpdated with old and new values", async function () {
      await expect(escrow.connect(owner).setFeeBps(300))
        .to.emit(escrow, "FeeUpdated")
        .withArgs(250n, 300n);
    });

    it("setFeeRecipient emits FeeRecipientUpdated with old and new addresses", async function () {
      await expect(escrow.connect(owner).setFeeRecipient(stranger.address))
        .to.emit(escrow, "FeeRecipientUpdated")
        .withArgs(feeRecipient.address, stranger.address);
    });

    it("non-owner cannot call setFeeBps", async function () {
      await expect(escrow.connect(stranger).setFeeBps(100))
        .to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("setFeeBps reverts if fee exceeds 10% (1000 bps)", async function () {
      await expect(escrow.connect(owner).setFeeBps(1001))
        .to.be.revertedWith("Fee too high");
    });

    it("setFeeBps accepts exactly 10% (1000 bps)", async function () {
      await expect(escrow.connect(owner).setFeeBps(1000)).to.not.be.reverted;
    });

    // [SEC-L1] Marketplace constructor zero-address checks
    it("marketplace constructor rejects zero token address", async function () {
      const MarketplaceFactory = await ethers.getContractFactory("JayDeMarketplace");
      await expect(
        MarketplaceFactory.deploy(ethers.ZeroAddress, await escrow.getAddress(), owner.address)
      ).to.be.revertedWith("Zero token address");
    });

    it("marketplace constructor rejects zero escrow address", async function () {
      const MarketplaceFactory = await ethers.getContractFactory("JayDeMarketplace");
      await expect(
        MarketplaceFactory.deploy(await token.getAddress(), ethers.ZeroAddress, owner.address)
      ).to.be.revertedWith("Zero escrow address");
    });

    // [SEC-L2] Escrow constructor zero-address checks
    it("escrow constructor rejects zero token address", async function () {
      const EscrowFactory = await ethers.getContractFactory("JayDeEscrow");
      await expect(
        EscrowFactory.deploy(ethers.ZeroAddress, feeRecipient.address, owner.address)
      ).to.be.revertedWith("Zero token address");
    });

    it("escrow constructor rejects zero fee recipient", async function () {
      const EscrowFactory = await ethers.getContractFactory("JayDeEscrow");
      await expect(
        EscrowFactory.deploy(await token.getAddress(), ethers.ZeroAddress, owner.address)
      ).to.be.revertedWith("Zero fee recipient");
    });

    // [SEC-M1/M2] nonReentrant on disputeTrade / disputePurchase — verified indirectly via
    // normal dispute flow (guard doesn't interfere with expected usage)
    it("disputePurchase works normally — nonReentrant guard does not break the flow", async function () {
      await createAndPurchase();
      await expect(marketplace.connect(buyer).disputePurchase(1)).to.not.be.reverted;
      const trade = await escrow.trades(1);
      expect(trade.status).to.equal(3); // DISPUTED
    });
  });
});
