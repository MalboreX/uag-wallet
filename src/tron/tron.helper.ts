import TransferDto from "src/common/dto/out.get.Transfer.dto";

const decimalsTrx = 6;

async function GetTransfersFromTrx(
  tronWeb,
  trxTransactions,
  walletAddress: string,
): Promise<TransferDto[]> {
  const transfers = [];
  trxTransactions.data?.forEach((trxTransaction) => {
    trxTransaction?.raw_data?.contract?.forEach((data) => {
      const to = tronWeb.address.fromHex(data.parameter?.value?.to_address);

      if (data.type === 'TransferContract' && to === walletAddress) {
        const amount = data.parameter?.value?.amount / 10 ** decimalsTrx;
        const txID = trxTransaction.txID;
        const from = tronWeb.address.fromHex(
          data.parameter?.value?.owner_address,
        );

        transfers.push({
          amount,
          txID,
          symbol: 'TRX',
          from,
        });
      }
    });
  });
  return transfers;
}

async function GetTransfersFromTrc20(trc20Transactions, walletAddress: string) {
  const transfers = [];
  trc20Transactions.data?.forEach((trc20Transaction) => {
    if (
      trc20Transaction.type == 'Transfer' &&
      trc20Transaction.to == walletAddress
    ) {
      const amount =
        trc20Transaction.value / 10 ** trc20Transaction.token_info?.decimals;
      const txID = trc20Transaction.transaction_id;
      const from = trc20Transaction.from;
      const symbol = trc20Transaction.token_info?.symbol;

      transfers.push({
        amount,
        txID,
        symbol,
        from,
        contract: trc20Transaction.token_info?.address,
      });
    }
  });
  return transfers;
}

export { GetTransfersFromTrx, GetTransfersFromTrc20 };
