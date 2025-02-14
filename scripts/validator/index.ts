import { ApiPromise, Keyring, WsProvider } from "@polkadot/api";
import { mnemonicGenerate, decodeAddress } from "@polkadot/util-crypto";
import { KeypairType } from "@polkadot/util-crypto/types";
import { KeyringPair } from "@polkadot/keyring/types";
import { EventRecord, ExtrinsicStatus } from "@polkadot/types/interfaces";
import * as dotenv from "dotenv";
import * as BN from 'bn.js';
import axios from 'axios';

const MNEMONIC_WORDS_COUNT = 12;

// https://stackoverflow.com/questions/10011011/using-node-js-how-do-i-read-a-json-file-into-server-memory
var fs = require('fs');
// var types = JSON.parse(fs.readFileSync('types.json', 'utf8'));
const types = {
  "Approval": {
    "amount": "Balance",
    "deposit": "DepositBalance"
  },
  "BabeEpochConfiguration": {
    "c": "(u64, u64)",
    "allowed_slots": "AllowedSlots"
  },
  "ApprovalKey": {
    "owner": "AccountId",
    "delegate": "AccountId"
  },
  "DestroyWitness": {
    "accounts": "Compact<u32>",
    "sufficients": "Compact<u32>",
    "approvals": "Compact<u32>"
  },
  "Properties": "u8",
  "NFTMetadata": "Vec<u8>",
  "BlockNumber": "u32",
  "BlockNumberOf": "BlockNumber",
  "OrderData": {
    "currencyId": "Compact<CurrencyIdOf>",
    "price": "Compact<Balance>",
    "deposit": "Compact<Balance>",
    "deadline": "Compact<BlockNumberOf>",
    "categoryId": "Compact<CategoryIdOf>"
  },
  "CategoryId": "u32",
  "CategoryIdOf": "CategoryId",
  "CategoryData": {
    "metadata": "NFTMetadata",
    "nftCount": "Compact<Balance>"
  },
  "CurrencyId": "u32",
  "CurrencyIdOf": "CurrencyId",
  "Amount": "i128",
  "AmountOf": "Amount",
  "ClassId": "u32",
  "ClassIdOf": "ClassId",
  "ClassInfoOf": {
    "metadata": "NFTMetadata",
    "totalIssuance": "TokenId",
    "owner": "AccountId",
    "data": "ClassData"
  },
  "ClassData": {
    "deposit": "Compact<Balance>",
    "properties": "Properties",
    "name": "Vec<u8>",
    "description": "Vec<u8>",
    "createBlock": "Compact<BlockNumberOf>"
  },
  "TokenId": "u64",
  "TokenIdOf": "TokenId",
  "TokenInfoOf": {
    "metadata": "NFTMetadata",
    "owner": "AccountId",
    "data": "TokenData"
  },
  "TokenData": {
    "deposit": "Compact<Balance>",
    "createBlock": "Compact<BlockNumberOf>"
  }
}

dotenv.config();
class Validator {
  private api: ApiPromise;
  private keyRingType: KeypairType;
  private rootAccount: KeyringPair;
  private stashAccount: KeyringPair;
  private controllerAccount: KeyringPair;
  private sessionKey;
  private rootBalance: number;
  private stashBalance: number;
  private controllerBalance: number;

  /**
   * Initialization - Connecting to blockchain.
   */
  public async init() {
    const provider = process.env.PROVIDER;
    console.log(`Connecting to blockchain: ${provider}`);
    const wsProvider = new WsProvider(provider);
    this.api = await ApiPromise.create({ provider: wsProvider, types: types });
    /*
    this.api = await ApiPromise.create({ provider: wsProvider, types: {
        ChainId: 'u8',
        ResourceId: '[u8; 32]',
        TokenId: 'U256'
      }});
    */
    await this.api.isReady;
    const chain = await this.api.rpc.system.chain();
    console.log(`Connected to: ${chain}\n`);

    console.log("Check if syncing...");
    await this.callWithRetry(this.isSyncing.bind(this), {
      maxDepth: 100,
    });
    console.log("Sync is complete!");
  }

  private async isSyncing() {
    const response = await this.api.rpc.system.health();

        if (response.isSyncing.valueOf()) {
      throw new Error("Node is syncing")
    }
  }

  public async createAccounts() {
    console.log('Creating Stash and Controller accounts');

    this.stashAccount = this.generateAccount("Stash");
    console.log(`Stash account public key: ${this.stashAccount.address}`);
    this.controllerAccount = this.generateAccount("Controller");
    console.log(`Controller account public key ${this.controllerAccount.address}`);

    const stashAssetsResponse = await this.requestAssets(this.stashAccount);
    console.log('Stash assets transaction:', stashAssetsResponse?.data);

    const controllerAssetsResponse = await this.requestAssets(this.controllerAccount);
    console.log('Controller assets transaction:', controllerAssetsResponse?.data);

    await this.callWithRetry(this.isValidBalance.bind(this));

    console.log(
      `Your Stash Account is ${this.stashAccount.address} and balance is ${this.stashBalance}`
    );
    console.log(
      `Your Controller Account is ${this.controllerAccount.address} and balance is ${this.controllerBalance}\n`
    );
  }

  private async setIdentity(account: KeyringPair, name: string){
    const identityInfo = this.api.createType('IdentityInfo', {
      additional: [],
      display: { raw: name},
      legal: { none: null },
      web: { none: null },
      riot: { none: null },
      email: { none: null },
      image: { none: null },
      twitter: { none: null },
    });
    return new Promise((res, rej) => {
      this.api.tx.identity.setIdentity(identityInfo)
        .signAndSend( account, this.sendStatusCb.bind(this, res, rej))
        .catch((err) => rej(err));
    });
  }

  /**
   * Load stash and controller accounts.
   */
  public async loadAccounts() {
    console.log(`Loading your accounts`);
    const keyring = new Keyring({ type: "sr25519" });
    this.rootAccount = keyring.addFromMnemonic(process.env.ROOT_ACCOUNT_MNEMONIC);
    this.stashAccount = keyring.addFromMnemonic(process.env.STASH_ACCOUNT_MNEMONIC);
    this.controllerAccount = keyring.addFromMnemonic(process.env.CONTROLLER_ACCOUNT_MNEMONIC);
    await this.requestEndowment(this.stashAccount);
    await this.requestEndowment(this.controllerAccount);
    await this.setIdentity(this.stashAccount, process.env.STASH_ACCOUNT_MNEMONIC);
    await this.setIdentity(this.controllerAccount, process.env.CONTROLLER_ACCOUNT_MNEMONIC);
    this.rootBalance = await this.getBalance(this.rootAccount)
    this.stashBalance = await this.getBalance(this.stashAccount)
    this.controllerBalance = await this.getBalance(this.controllerAccount)
    console.log(
      `Your Root Account is ${this.rootAccount.address} and balance is ${this.rootBalance}`
    );
    console.log(
      `Your Stash Account is ${this.stashAccount.address} (${process.env.STASH_ACCOUNT_MNEMONIC}) and balance is ${this.stashBalance}`
    );
    console.log(
      `Your Controller Account is ${this.controllerAccount.address} (${process.env.CONTROLLER_ACCOUNT_MNEMONIC}) and balance is ${this.controllerBalance}\n`
    );
  }

  /**
   * Generate session key
   */
  public async generateSessionKey() {
    console.log(`\nGenerating Session Key`);
    this.sessionKey = await this.api.rpc.author.rotateKeys();
    console.log(`Session Key: ${this.sessionKey}`);
  }

  /**
   * Add validator to the node
   * @param bondValue The amount to be stashed
   * @param payee The rewards destination account
   */
  public async addValidator() {
    console.log(`\nAdding validator`);
    const bondValue = BigInt(Number(process.env.BOND_VALUE));
    console.log(`Bond value is ${bondValue}`);
    if (this.stashBalance <= Number(bondValue)) {
      throw new Error(`Bond value needs to be lesser than balance. (Bond ${bondValue} should be less than stash balance ${this.stashBalance})`);
    }

    const transaction = this.api.tx.staking.bond(
      this.controllerAccount.address,
      bondValue,
      "Staked"
    );

    return new Promise((res, rej) => {
      transaction
        .signAndSend(this.stashAccount, this.sendStatusCb.bind(this, res, rej))
        .catch((err) => rej(err));
    });
  }

  public async setController() {
    console.log(`\n Setting controller account`);
    const transaction = this.api.tx.staking.setController(
      this.controllerAccount.address
    );

    return new Promise((res, rej) => {
      transaction
        .signAndSend(this.stashAccount, this.sendStatusCb.bind(this, res, rej))
        .catch((err) => rej(err));
    });
  }

  /**
   * Set session key
   * @param sessionKey session key
   */
  public async setSessionKey() {
    console.log(`\nSetting session key`);
    const EMPTY_PROOF = new Uint8Array();
    const transaction = this.api.tx.session.setKeys(
      this.sessionKey,
      EMPTY_PROOF
    );

    return new Promise((res, rej) => {
      transaction
        .signAndSend(
          this.controllerAccount,
          this.sendStatusCb.bind(this, res, rej)
        )
        .catch((err) => rej(err));
    });
  }

  /**
   * set rewards commission
   * @param REWARD_COMMISSION rewards commission
   */
  public async setCommission() {
    console.log(`\nSetting reward commission`);
    // https://github.com/polkadot-js/apps/blob/23dad13c9e67de651e5551e4ce7cba3d63d8bb47/packages/page-staking/src/Actions/partials/Validate.tsx#L53
    const COMM_MUL = 10000000;
    const commission = +process.env.REWARD_COMMISSION * COMM_MUL;
    const transaction = this.api.tx.staking.validate({
      commission,
    });

    return new Promise((res, rej) => {
      transaction
        .signAndSend(
          this.controllerAccount,
          this.sendStatusCb.bind(this, res, rej)
        )
        .catch((err) => rej(err));
    });
  }

  public getNetworkName() {
    return process.env.NETWORK.toUpperCase().replace("-", "_");
  }

  private generateAccount(type: string) {
    const keyring = new Keyring({ type: "sr25519"});
    const mnemonic = mnemonicGenerate(MNEMONIC_WORDS_COUNT);
    const pair = keyring.addFromUri(mnemonic, {});

    console.log('=====================================================');
    console.log(`GENERATED ${MNEMONIC_WORDS_COUNT}-WORD MNEMONIC SEED (${type}):`);
    console.log(mnemonic);
    console.log('=====================================================');

    return keyring.addPair(pair);
  }

  private async requestEndowment(account: KeyringPair) {
    console.log('Requesting endowment for account', account.address);
    const oldBalance = await this.getBalance(account);
    const transfer = this.api.tx.balances.transfer(account.address, 1000000000000000);
    const hash = await transfer.signAndSend(this.rootAccount, {nonce: -1});
	    /*
    return new Promise((res, rej) => {
          transfer
	    .signAndSend(account, this.sendStatusCb.bind(this, res, rej))
	    .catch((err) => rej(err));
        // console.log('Endowment sent with hash', hash.toHex());
    });
	    */
    // const unsub = await transfer.signAndSend(this.rootAccount, {nonce: -1});
    while (true) {
      let newBalance = await this.getBalance(account);
      if (newBalance > oldBalance) {
        break;
      }
      console.log("please wait for transaction to finalize...")
      await this.sleep(1000);
    }
    /*
    const unsub = await this.api.tx.balances.transfer(account.address, 1000000000000000).signAndSend(this.rootAccount, ({events = [], status})=>{
      console.log(`Current status is ${status.type}`);

      if (status.isFinalized) {
        console.log(`Transaction included at blockHash ${status.asFinalized}`);

        // Loop through Vec<EventRecord> to display all events
	events.forEach(({ phase, event: { data, method, section } }) => {
	  console.log(`\t' ${phase}: ${section}.${method}:: ${data}`);
	});

	unsub();
      }

    });
    */
  }

  private async requestAssets(account: KeyringPair) {
    try {
      return await axios.post(
        process.env.REQUEST_ASSETS_ENDPOINT,
        { destination: account.address, network: this.getNetworkName() },
        {
          timeout: 50000,
          withCredentials: false,
          headers: {
            Accept: "application/json",
          },
        }
      );
    } catch(err) {
      console.log('Error requesting assets:', err.message)
      console.log(err.response.data)
      throw err;
    }
  }

  private async isValidBalance () {
    console.log('Requesting balance');
    this.stashBalance = await this.getBalance(this.stashAccount);
    this.controllerBalance = await this.getBalance(this.controllerAccount);

    if (this.stashBalance <= 0) {
      throw new Error('Stash balance should be above 0');
    }
  }

  private async getBalance(account: KeyringPair) {
    const result = await this.api.query.system.account(account.address);
    const {
      data: { free: balance },
    } = result;

    return Number(balance);
  }

  private async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async callWithRetry(fn, options = { maxDepth: 5}, depth = 0) {
    try {
      return await fn();
    } catch (e) {
      if (depth > options.maxDepth) {
        throw e;
      }
      const seconds = parseInt(process.env.WAIT_SECONDS, 10);
      console.log(`Wait ${seconds}s.`);
      await this.sleep(seconds * 1000);

      return this.callWithRetry(fn, options, depth + 1);
    }
  }

  private sendStatusCb(res, rej, {
    events = [],
    status,
  }: {
    events?: EventRecord[];
    status: ExtrinsicStatus;
  }) {
    if (status.isInvalid) {
      console.info("Transaction invalid");
      rej("Transaction invalid");
    } else if (status.isReady) {
      console.info("Transaction is ready");
    } else if (status.isBroadcast) {
      console.info("Transaction has been broadcasted");
    } else if (status.isInBlock) {
      const hash = status.asInBlock.toHex();
      console.info(`Transaction is in block: ${hash}`);
    } else if (status.isFinalized) {
      const hash = status.asFinalized.toHex();
      console.info(`Transaction has been included in blockHash ${hash}`);
      events.forEach(({ event }) => {
        if (event.method === "ExtrinsicSuccess") {
          console.info("Transaction succeeded");
        } else if (event.method === "ExtrinsicFailed") {
          console.info("Transaction failed");
          throw new Error("Transaction failed");
        }
      });

      res(hash);
    }
  }
}

async function main() {
  const validator = new Validator();
  await validator.init();
  await validator.loadAccounts();
  await validator.generateSessionKey();
  await validator.addValidator();
  await validator.setSessionKey();
  await validator.setCommission();

  console.log("Validator added successfully!");
}

main()
  .catch(console.error)
  .finally(() => process.exit());
