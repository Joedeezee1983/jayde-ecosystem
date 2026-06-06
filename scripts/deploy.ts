import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("=".repeat(50));
  console.log("JayDe Ecosystem — Deployment");
  console.log("=".repeat(50));
  console.log("Network      :", network.name);
  console.log("Deployer     :", deployer.address);
  console.log("Balance      :", ethers.formatEther(balance), "ETH");
  console.log("-".repeat(50));

  // --- 1. Deploy JayDeToken ---
  console.log("\n[1/2] Deploying JayDeToken...");
  const JayDeToken = await ethers.getContractFactory("JayDeToken");
  const token = await JayDeToken.deploy(deployer.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();

  const totalSupply = await token.totalSupply();
  console.log("  Address     :", tokenAddress);
  console.log("  Name        :", await token.name());
  console.log("  Symbol      :", await token.symbol());
  console.log("  Total Supply:", ethers.formatEther(totalSupply), "JAYDE");

  // --- 2. Deploy JayDeEscrow ---
  // Fee recipient defaults to deployer; swap this for a multisig on mainnet.
  const feeRecipient = deployer.address;

  console.log("\n[2/2] Deploying JayDeEscrow...");
  const JayDeEscrow = await ethers.getContractFactory("JayDeEscrow");
  const escrow = await JayDeEscrow.deploy(tokenAddress, feeRecipient, deployer.address);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();

  const feeBps = await escrow.feeBps();
  console.log("  Address     :", escrowAddress);
  console.log("  Token       :", await escrow.jaydeToken());
  console.log("  Fee         :", feeBps.toString(), "bps (" + (Number(feeBps) / 100) + "%)");
  console.log("  Fee Recipient:", await escrow.feeRecipient());
  console.log("  Owner       :", await escrow.owner());

  // --- 3. Summary ---
  console.log("\n" + "=".repeat(50));
  console.log("Deployment Summary");
  console.log("=".repeat(50));
  console.log("JayDeToken  :", tokenAddress);
  console.log("JayDeEscrow :", escrowAddress);
  console.log("=".repeat(50));

  // --- 4. Save to deployments.json ---
  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  const deploymentsFile = path.join(deploymentsDir, "deployments.json");

  // Preserve previous deployments for other networks
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(deploymentsFile)) {
    existing = JSON.parse(fs.readFileSync(deploymentsFile, "utf8"));
  }

  existing[network.name] = {
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      JayDeToken: {
        address: tokenAddress,
        totalSupply: ethers.formatEther(totalSupply),
        symbol: "JAYDE",
      },
      JayDeEscrow: {
        address: escrowAddress,
        feeRecipient,
        feeBps: feeBps.toString(),
      },
    },
  };

  fs.writeFileSync(deploymentsFile, JSON.stringify(existing, null, 2));
  console.log("\nAddresses saved to deployments/deployments.json");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
