import { expect } from "chai";
import { ethers } from "hardhat";
import { JayDeToken } from "../typechain-types";

describe("JayDeToken", function () {
  let token: JayDeToken;
  let owner: any;
  let addr1: any;

  const MAX_SUPPLY = ethers.parseEther("1000000000"); // 1 billion

  beforeEach(async function () {
    [owner, addr1] = await ethers.getSigners();
    const JayDeToken = await ethers.getContractFactory("JayDeToken");
    token = await JayDeToken.deploy(owner.address);
  });

  it("should have correct name and symbol", async function () {
    expect(await token.name()).to.equal("JayDe Token");
    expect(await token.symbol()).to.equal("JAYDE");
  });

  it("should mint 1 billion tokens to owner on deploy", async function () {
    expect(await token.totalSupply()).to.equal(MAX_SUPPLY);
    expect(await token.balanceOf(owner.address)).to.equal(MAX_SUPPLY);
  });

  it("should allow owner to transfer tokens", async function () {
    const amount = ethers.parseEther("1000");
    await token.transfer(addr1.address, amount);
    expect(await token.balanceOf(addr1.address)).to.equal(amount);
  });

  it("should allow token burning", async function () {
    const burnAmount = ethers.parseEther("1000");
    await token.burn(burnAmount);
    expect(await token.totalSupply()).to.equal(MAX_SUPPLY - burnAmount);
  });

  it("should expose correct MAX_SUPPLY constant", async function () {
    expect(await token.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
  });
});
