import { ExtrinsicStatus } from "@polkadot/types/interfaces";
import { EventRecord } from "@polkadot/types/interfaces";
import { KeyringPair } from "@polkadot/keyring/types";
import { ApiPromise } from "@polkadot/api";
import { WsProvider } from "@polkadot/api";
import { formatBalance, stringToU8a } from "@polkadot/util";
import dayjs from 'dayjs';

class Network {
  public api: ApiPromise;

  constructor(private readonly config: any) {}

  public async setup() {
    console.log("About to initializing network\n");
    await this.init(this.config.network.url);
  }

  /**
   * Initialize the network
   * @param url {string} Network Provider
   */
  private async init(url: string) {
    console.log(`Connecting to blockchain: ${url}\n`);
    const wsProvider = new WsProvider(url);
    this.api = await ApiPromise.create({
      provider: wsProvider,
      types: {
        ChainId: "u8",
        ResourceId: "[u8; 32]",
        TokenId: "U256",
      },
    });
    await this.api.isReady;
    const chain = await this.api.rpc.system.chain();
    console.log(`Connected to: ${chain}\n`);
  }

  /**
   * Transfer native assets
   * @param sender sender keyringpair
   * @param destination destination address
   * @param value amount to be transfered
   * @returns hash
   */
  public async transfer(
    sender: KeyringPair,
    destination: string,
    value: string
  ): Promise<any> {
    const amount = +value * 10 ** this.config.network.decimals;
    console.log(
      `About to transfer ${amount} native assets to ${destination} from ${sender.address}\n`
    );
    const { nonce } = await this.api.query.system.account(sender.address);

    const transfer = this.api.tx.balances.transfer(destination, amount);
    return transfer;
  }

  /**
   * Fetch native token balance
   * @param address account addess
   * @returns
   */
  public async getBalance(address: string) {
    console.log(`About to get balance for: ${address}\n`);
    const {
      data: { free: balance },
    } = await this.api.query.system.account(address);
    return formatBalance(balance, { decimals: this.config.network.decimals });
  }

  /**
   * Fetch Existential Deposit
   * @returns existential deposit
   */
  public existentialDeposit() {
    console.log(`About to get Existential Deposit\n`);
    const existentialDeposit = this.api.consts.balances.existentialDeposit;
    const value = +existentialDeposit / 10 ** this.config.network.decimals;
    return value;
  }

  /**
   * send ddc transaction
   * @param sender senders keyringpair
   * @param destination destination address
   * @param data data to be added
   * @returns Transaction
   */
  public async sendDDC(sender: KeyringPair, destination: string, data: string) {
    console.log(
      `About to send ddc transaction from ${sender.address} to ${destination} as ${data}\n`
    );

    const txnObj = await this.api.tx.cereDdcModule.sendData(destination, data);

    return txnObj;
  }

  /**
   * Get Treasury balance
   * @returns Balance
   */
  public async treasuryBalance() {
    const treasuryAccount = stringToU8a("modlpy/trsry".padEnd(32, "\0"));
    const {
      data: { free: balance },
    } = await this.api.query.system.account(treasuryAccount);
    const formatedBalance = formatBalance(balance, {
      decimals: this.config.network.decimals,
    });
    return formatedBalance;
  }

  public async signAndSendTxn(txn: any, sender: KeyringPair) {
    console.log(`Signing and sending transaction`);
    const { nonce } = await this.api.query.system.account(sender.address);
    return new Promise((res, rej) => {
      txn
        .signAndSend(
          sender,
          { nonce },
          Network.sendStatusCb.bind(this, res, rej)
        )
        .catch((err) => rej(err));
    });
  }

  public async signAndSendBathTxn(txs: any, sender: KeyringPair) {
    console.log(`Sending batch transaction`);
    const nonce = await this.api.rpc.system.accountNextIndex(sender.address);
    console.log(`nonce: ${nonce}`);
    return new Promise((res, rej) => {
      this.api.tx.utility
        .batch(txs)
        .signAndSend(
          sender,
          { nonce },
          Network.sendStatusCb.bind(this, res, rej)
        )
        .catch((err) => rej(err));
    });
  }

  /**
   * Calculate the remaining ERA time. 
   * @returns Era Start time
   */
  public async eraTime() {
    console.log(`Calculating remaining ERA time`);
    const era = await this.api.query.staking.activeEra();
    const pr = JSON.stringify(era)
    const sr = JSON.parse(pr);
    const startTime = sr.start;
    const start = dayjs(startTime).format();
    const currentTime = dayjs(new Date);
    const diff = currentTime.diff(start, "minutes");
    const eraTime = +this.config.network.era_time;
    return eraTime - diff;
  }

  /**
   * Check for send status call back function
   * @param res Promise response object
   * @param rej Promise reject object
   */
  public static sendStatusCb(
    res,
    rej,
    {
      events = [],
      status,
    }: {
      events?: EventRecord[];
      status: ExtrinsicStatus;
    }
  ) {
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

export default Network;
