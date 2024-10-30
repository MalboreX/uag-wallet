import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { TronService } from './tron.service';
import WalletDto from 'src/common/dto/out.post.Wallet.dto';

@Controller('tron')
export class TronController {
  constructor(private tronService: TronService) { }

  @Post('createAccount')
  async createAccount(): Promise<WalletDto> {
    return await this.tronService.createAccount();
  }

  @Post('validateAccount')
  async validateAccount(@Body() body: any): Promise<WalletDto> {
    return await this.tronService.validateAccount(body.mnemonics);
  }

  @Get('verifiedTokens')
  async verifiedTokens() {
    return await this.tronService.getVerifiedTokens();
  }

  @Get('walletDetails')
  async walletDetails(@Query() query) {
    return await this.tronService.queryWalletDetails(query.walletAddress, query.contracts ?? []);
  }

  @Get('contractInfo')
  async contractInfo(@Query() query) {
    return await this.tronService.queryContractInfo(query.contractAddress);
  }

  @Get('transactions')
  async transactionsList(@Query() query) {
    return await this.tronService.queryListTransactions(query.walletAddress);
  }

  @Get('transaction')
  async transaction(@Query() query) {
    return await this.tronService.queryTransaction(query.txId);
  }

  @Post('sendTrc20')
  async sendTrc20(@Body() body: any) {
    return await this.tronService.sendTrc20(body.contractAddress, body.amount, body.fromAddress, body.toAddress, body.privateKey);
  }

  @Post('sendTrx')
  async sendTrx(@Body() body: any) {
    return await this.tronService.sendTrx(body.amount, body.fromAddress, body.toAddress, body.privateKey);
  }
}
