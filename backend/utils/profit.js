export const computeProfit = ({ revenueUSD=0, adCostUSD=0, deliveryCostsUSD=0, productCostUSD=0, extraCostsUSD=0 }) => {
  return revenueUSD - (adCostUSD + deliveryCostsUSD + productCostUSD + extraCostsUSD);
};
