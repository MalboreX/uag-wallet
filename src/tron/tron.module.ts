import { Module } from '@nestjs/common';
import { TronService } from './tron.service';
import { TronController } from './tron.controller';

@Module({
  providers: [TronService],
  controllers: [TronController],
})
export class TronModule {}
