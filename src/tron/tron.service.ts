import { Inject, Injectable, Sse } from '@nestjs/common';
import { TronTransactionHash } from './dto';
import TronWeb from 'tronweb';
import TronGrid from 'trongrid';
import { GetTransfersFromTrc20, GetTransfersFromTrx } from './tron.helper';
import WalletDto from 'src/common/dto/out.post.Wallet.dto';
import TransferDto from 'src/common/dto/out.get.Transfer.dto';
import axios, { all } from 'axios';
import { CACHE_MANAGER, CacheKey, CacheTTL } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import tronscanFactory from 'src/api/tronscan';
import ContractInfo from './dto/contract-info';
const bip39 = require('bip39');
const ecc = require('tiny-secp256k1');
const { BIP32Factory } = require('bip32')
const bip32 = BIP32Factory(ecc);
const { parseString } = require('xml2js');

@Injectable()
export class TronService {
  private tronWeb: TronWeb;
  private tronGrid: TronGrid;
  private tronscanApi: any;

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {
    this.tronWeb = new TronWeb({
      fullHost: process.env.TRONGRID_API,
      headers: { 'TRON-PRO-API-KEY': process.env.TRONGRID_API_KEY }
    });
    this.tronGrid = new TronGrid(this.tronWeb);
    this.tronscanApi = tronscanFactory(process.env.TRONSCAN_API_KEY);
  }

  async createAccount(): Promise<WalletDto> {
    const account = await this.tronWeb.createRandom();

    return {
      address: account.address,
      publicKey: account.publicKey,
      privateKey: account.privateKey,
      mnemonics: account.mnemonic.phrase
    };
  }

  async validateAccount(mnemonics: string) {
    mnemonics = mnemonics.trim();
    const isMnemonic = mnemonics.split(' ').length >= 12;
    if (isMnemonic) {
      const seed = bip39.mnemonicToSeedSync(mnemonics);
      const root = bip32.fromSeed(seed);
      const child = root.derivePath("m/44'/195'/0'/0/0");

      const privateKey = this.uint8ArrayToHexString(child.privateKey);
      const publicKey = this.uint8ArrayToHexString(child.publicKey);
      const address = this.tronWeb.address.fromPrivateKey(privateKey.replace('0x', ''));

      return {
        address: address,
        publicKey: publicKey,
        privateKey: privateKey,
        mnemonics: mnemonics
      };
    } else {
      const privateKey = mnemonics;
      const address = this.tronWeb.address.fromPrivateKey(privateKey.replace('0x', ''));

      return {
        address: address,
        publicKey: '',
        privateKey: privateKey,
        mnemonics: privateKey,
      };
    }
  }

  uint8ArrayToHexString(uint8Array) {
    const hexArray = Array.from(uint8Array, (byte: number) => byte.toString(16).padStart(2, '0'));
    return '0x' + hexArray.join('');
  }

  async getVerifiedTokens(): Promise<any[]> {
    const cachedResponse = await this.cacheManager.get('verified_tokens');
    if (!cachedResponse) {
      let tokens = [];

      const tronToken = await this.tronscanApi.get('/tokens/overview?start=0&limit=10&showAll=0&filter=top&sort=marketcap');
      const tron = tronToken.data.tokens.find(t => t.contractAddress == "_");

      if (tron) {
        tokens.push({
          name: tron.name,
          abbr: tron.abbr,
          contractAddress: tron.contractAddress,
          decimals: tron.decimal,
          iconUrl: tron.imgUrl,
          priceInUsd: tron.priceInUsd
        });
      }

      const response = await this.tronscanApi.get('/tokens/overview?start=0&limit=100&showAll=0&filter=trc20&sort=marketcap');
      const restTokens = response.data.tokens;

      for (let i = 0; i < restTokens.length; i++) {
        tokens.push({
          name: restTokens[i].name,
          abbr: restTokens[i].abbr,
          contractAddress: restTokens[i].contractAddress,
          decimals: restTokens[i].decimal,
          iconUrl: restTokens[i].imgUrl,
          priceInUsd: restTokens[i].priceInUsd ?? 0
        });
      }

      if (tokens.length > 1)
        await this.cacheManager.set('verified_tokens', tokens, 1000 * 60);

      return tokens;
    } else return cachedResponse as [];
  }

  async queryWalletDetails(walletAddress: string, contracts: string[]) {
    try {
      const rouble = await this.queryRouble();
      const queryTokensData = await this.tronscanApi.get(`/account/wallet?address=${walletAddress}&asset_type=0`);
      const tokensInWallet = queryTokensData.data.data;
      const verifiedTokens = await this.getVerifiedTokens();
      const result = [];
      for (let contract of contracts) {
        const verifiedContractIndex = verifiedTokens.findIndex(x => x.contractAddress == contract);
        if (verifiedContractIndex >= 0) {
          const contractDetails = verifiedTokens[verifiedContractIndex];
          let balance = 0;

          const tokenInWallet = tokensInWallet.find(x => x?.token_id == contract);
          if (tokenInWallet)
            balance = tokenInWallet.balance;

          result.push({
            name: contractDetails.name,
            abbr: contractDetails.abbr,
            contractAddress: contractDetails.contractAddress,
            decimals: contractDetails.decimals,
            iconUrl: contractDetails.iconUrl,
            priceInUsd: parseFloat(contractDetails.priceInUsd),
            priceInRouble: parseFloat(contractDetails.priceInUsd) * rouble,
            balance: balance,
          });

        } else {
          const contractDetails = await this.queryContractInfo(contract);
          let balance = 0;

          const tokenInWallet = tokensInWallet.find(x => x.token_id == contract);
          if (tokenInWallet)
            balance = tokenInWallet.balance;

          if (contractDetails) {
            result.push({
              name: contractDetails.name,
              abbr: contractDetails.abbr,
              contractAddress: contractDetails.contractAddress,
              decimals: contractDetails.decimals,
              iconUrl: contractDetails.iconUrl,
              priceInUsd: 0,
              balance: balance,
            });
          }
        }
      }

      return result;
    } catch (error) {
      console.error(error);
    }
  }

  async queryRouble(): Promise<number> {
    const cachedResponse = await this.cacheManager.get(`rates_rouble`);
    if (!cachedResponse) {
      let rouble = 0;
      const response = await axios.get('https://www.cbr.ru/scripts/XML_daily.asp');
      parseString(response.data, (err, result) => {
        if (err) {
          console.error('Ошибка парсинга:', err);
          return;
        }

        const valutes = result.ValCurs.Valute;
        valutes.forEach((valute) => {
          if (valute.CharCode[0] === 'USD') {
            rouble = parseFloat(valute.Value[0].replace(',', '.'));
          }
        });
      });
      await this.cacheManager.set(`rates_rouble`, rouble, 1000 * 60 * 60 * 24);
      return rouble;
    }
    return cachedResponse as number;
  }

  async queryContractInfo(contractAddress: string): Promise<ContractInfo> {
    try {
      const cachedResponse = await this.cacheManager.get(`queryContractInfo_${contractAddress}`);
      if (!cachedResponse) {
        const queryTokenData = await this.tronscanApi.get(`/token_trc20?contract=${contractAddress}`);
        const contract = queryTokenData.data.trc20_tokens.find(t => t.contract_address == contractAddress);

        const result = {
          name: contract.name,
          abbr: contract.symbol,
          contractAddress: contract.contract_address,
          decimals: contract.decimals,
          iconUrl: contract.icon_url,
        };

        if (result)
          await this.cacheManager.set(`queryContractInfo_${contractAddress}`, result, 1000 * 60 * 60 * 24 * 5);
        return result;
      } else return cachedResponse as ContractInfo;
    }
    catch (e) {
      console.error(e);
    }
    return null;
  }

  async queryTransaction(txId: string) {
    const transaction = await this.tronWeb.trx.getTransaction(txId);
    return transaction;
  }

  async queryListTransactions(walletAddress: string, limit: number = 1, fingerprint: string) {

    await this.tronWeb.setAddress(walletAddress);

    const transactions = [];

    const options = {
      onlyConfirmed: true,
      limit,
      orderBy: 'timestamp,desc',
      fingerprint,
    };

    const transactionsResponse = await this.tronGrid.account.getTransactions(walletAddress, options);

    const meta = transactionsResponse.meta;

    for (let i = 0; i < transactionsResponse.data.length; i++) {

      const event = transactionsResponse.data[i].raw_data.contract[0].type;

      let amount = 0;
      let isTrx = false;
      let from_address = '';
      let to_address = '';
      let contract_address = null;
      let contract_decimals = null;

      if (event == 'TransferContract') {
        isTrx = true;
        amount = parseFloat(this.tronWeb.fromSun(transactionsResponse.data[i].raw_data.contract[0].parameter.value.amount));
        to_address = this.tronWeb.address.fromHex(transactionsResponse.data[i].raw_data.contract[0].parameter.value.to_address);
        from_address = this.tronWeb.address.fromHex(transactionsResponse.data[i].raw_data.contract[0].parameter.value.owner_address);
      } else if (event == 'TriggerSmartContract') {
        const call_data = transactionsResponse.data[i].raw_data.contract[0].parameter.value.data;
        const parameters = this.parseTransactionData(call_data);

        contract_address = this.tronWeb.address.fromHex(transactionsResponse.data[i].raw_data.contract[0].parameter.value.contract_address);
        const contract = await this.tronWeb.contract().at(contract_address);
        contract_decimals = await contract.decimals().call();
        amount = parseFloat(parameters.value) / 10 ** contract_decimals;

        from_address = walletAddress;
        to_address = this.tronWeb.address.fromHex(parameters.address);
      } else if (event == 'TransferAssetContract') {
        to_address = this.tronWeb.address.fromHex(transactionsResponse.data[i].raw_data.contract[0].parameter.value.to_address);
        from_address = this.tronWeb.address.fromHex(transactionsResponse.data[i].raw_data.contract[0].parameter.value.owner_address);
        amount = parseFloat(this.tronWeb.fromSun(transactionsResponse.data[i].raw_data.contract[0].parameter.value.amount));
      }

      transactions.push({
        txID: transactionsResponse.data[i].txID,
        status: transactionsResponse.data[i].ret[0].contractRet,
        isTrx,
        event,
        amount,
        from_address,
        to_address,
        contract_address,
        contract_decimals
      });
    }

    return {
      meta,
      transactions
    };
  }

  parseTransactionData(data: string) {
    if (data.startsWith('0x')) {
      data = data.slice(2);
    }

    const functionSelector = data.slice(0, 8);

    const addressHex = data.slice(8, 72);
    const address = '0x' + addressHex.slice(24);

    const valueHex = data.slice(72, 136);
    const value = BigInt('0x' + valueHex.toString());

    return {
      functionSelector,
      address,
      value: value.toString()
    };
  }


  async updateFields(obj) {
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          this.updateFields(obj[key]);
        }

        if (key === 'receiver_address' || key === 'owner_address' || key === 'contract_address') {
          obj[key] = this.hexAddressToBase58(obj[key]);
        }
      }
    }
  }

  hexAddressToBase58 = (hexAddress) => {
    let retval = hexAddress;
    try {
      if (hexAddress.startsWith("0x")) {
        hexAddress = '41' + hexAddress.substring(2);
      }
      let bArr = this.tronWeb.utils['code'].hexStr2byteArray(hexAddress);
      retval = this.tronWeb.utils['crypto'].getBase58CheckAddress(bArr);
    } catch (e) {
      //Handle
    }
    return retval;
  }

  async sendTrc20(
    contractAddress: string,
    amount: string,
    from: string,
    to: string,
    privateKey: string,
  ) {
    if (privateKey.startsWith("0x")) {
      privateKey = privateKey.replace('0x', '');
    }
    this.tronWeb.setAddress(from);
    this.tronWeb.setPrivateKey(privateKey);

    const contract = await this.tronWeb.contract().at(contractAddress);
    const decimals = await contract.decimals().call();
    const tokenAmount = parseFloat(amount) * 10 ** decimals;
    const hash = await contract.transfer(to, tokenAmount).send();

    return {
      hash,
    };
  }

  async sendTrx(
    amount: string,
    from: string,
    to: string,
    privateKey: string,
  ) {
    if (privateKey.startsWith("0x")) {
      privateKey = privateKey.replace('0x', '');
    }
    this.tronWeb.setAddress(from);
    this.tronWeb.setPrivateKey(privateKey);

    const tokenAmount = parseFloat(amount) * 10 ** 6;

    const hash = await this.tronWeb.trx.sendTransaction(to, tokenAmount);
    return {
      success: true,
      hash
    };
  }
}
