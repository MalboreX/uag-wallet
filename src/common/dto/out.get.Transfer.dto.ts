interface TransferDto {
  amount: number;
  symbol: string;
  from: string;
  txID: string;
  contract?: string;
}

export default TransferDto;
