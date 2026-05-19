import type { FlightSample, FlightSummary, PlatformName, PlatformQuote } from "./types";

function availableQuotes(quotes: PlatformQuote[]) {
  return quotes.filter((quote) => quote.available && typeof quote.price === "number");
}

function formatGap(gap: number) {
  return `${Math.abs(gap)}元`;
}

export function summarizeFlight(sample: FlightSample): FlightSummary {
  const available = availableQuotes(sample.quotes);
  const competitors = available.filter((quote) => quote.platform !== "青猫差旅");
  const qingmao = sample.quotes.find((quote) => quote.platform === "青猫差旅");
  const qingmaoPrice = qingmao?.available ? qingmao.price : null;

  if (typeof qingmaoPrice !== "number" || !competitors.length) {
    return {
      sampleId: sample.id,
      lowestPlatform: "",
      qingmaoGap: null,
      availablePlatformCount: available.length,
      evidenceCount: sample.quotes.filter((quote) => quote.evidencePath).length,
      conclusion: "青猫差旅或其他平台暂无同航班可比价格，保留截图证据。"
    };
  }

  const lowest = [...competitors].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0];
  const qingmaoGap = qingmaoPrice - (lowest.price ?? qingmaoPrice);
  let conclusion = "";

  if (qingmaoGap < 0) {
    conclusion = `青猫差旅较竞品最低价低${formatGap(qingmaoGap)}。`;
  } else if (qingmaoGap === 0) {
    conclusion = "青猫差旅与竞品最低价持平。";
  } else {
    conclusion = `青猫差旅高于${lowest.platform}${formatGap(qingmaoGap)}。`;
  }

  return {
    sampleId: sample.id,
    lowestPlatform: lowest.platform as PlatformName,
    qingmaoGap,
    availablePlatformCount: available.length,
    evidenceCount: sample.quotes.filter((quote) => quote.evidencePath).length,
    conclusion
  };
}
