import type { CompetitorPlatformName, FlightSample, FlightSummary, PlatformName, PlatformQuote, PriceComparisonOptions, PriceComparisonSummary } from "./types";

const flightSummaryPlatforms: PlatformName[] = ["青猫差旅", "携程商旅", "阿里商旅", "在途商旅"];
const competitorPlatforms: CompetitorPlatformName[] = ["携程商旅", "阿里商旅", "在途商旅"];

function comparisonQuotes(quotes: PlatformQuote[]) {
  return quotes.filter((quote) => flightSummaryPlatforms.includes(quote.platform));
}

function availableQuotes(quotes: PlatformQuote[]) {
  return comparisonQuotes(quotes).filter((quote) => quote.available && typeof quote.price === "number");
}

function quoteByPlatform(quotes: PlatformQuote[], platform: PlatformName) {
  return comparisonQuotes(quotes).find((quote) => quote.platform === platform);
}

function availablePrice(quote: PlatformQuote | undefined) {
  return quote?.available && typeof quote.price === "number" ? quote.price : null;
}

function formatGap(gap: number) {
  return `${Math.round(Math.abs(gap))}元`;
}

function average(prices: number[]) {
  return prices.reduce((sum, price) => sum + price, 0) / prices.length;
}

function normalizedOptions(options: PriceComparisonOptions = {}): PriceComparisonOptions {
  const comparisonMode = options.comparisonMode ?? "internal_discussion";
  const specifiedPlatform =
    comparisonMode === "specified_platform" && options.specifiedPlatform && competitorPlatforms.includes(options.specifiedPlatform)
      ? options.specifiedPlatform
      : undefined;

  return {
    comparisonMode,
    specifiedPlatform
  };
}

function averageComparisonLabel(gap: number) {
  if (gap < 0) return `低于竞品平均价${formatGap(gap)}`;
  if (gap > 0) return `高于竞品平均价${formatGap(gap)}`;
  return "与竞品平均价持平";
}

function specifiedPlatformLabel(platform: CompetitorPlatformName, gap: number) {
  if (gap < 0) return `对比${platform}低了${formatGap(gap)}`;
  if (gap > 0) return `对比${platform}高了${formatGap(gap)}`;
  return `与${platform}持平`;
}

function unavailableSummary(label = "暂无完整可比价格", conclusion = "青猫差旅或其他平台暂无完整可比价格。", competitorCount = 0): PriceComparisonSummary {
  return {
    lowestPlatform: "",
    qingmaoGap: null,
    comparisonBasis: "unavailable",
    comparisonLabel: label,
    competitorCount,
    conclusion
  };
}

export function summarizeQuoteSet(quotes: PlatformQuote[], rawOptions: PriceComparisonOptions = {}): PriceComparisonSummary {
  const options = normalizedOptions(rawOptions);
  const available = availableQuotes(quotes);
  const competitors = available.filter((quote) => quote.platform !== "青猫差旅");
  const qingmaoPrice = availablePrice(quoteByPlatform(quotes, "青猫差旅"));
  const lowestOverall = [...available].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0];

  if (typeof qingmaoPrice !== "number") {
    return unavailableSummary();
  }

  if (options.comparisonMode === "specified_platform") {
    if (!options.specifiedPlatform) {
      return unavailableSummary("暂无", "未指定可比竞品平台。");
    }

    const selectedCompetitorPrice = availablePrice(quoteByPlatform(quotes, options.specifiedPlatform));
    if (typeof selectedCompetitorPrice !== "number") {
      return {
        lowestPlatform: lowestOverall?.platform as PlatformName,
        qingmaoGap: null,
        comparisonBasis: "specifiedPlatformUnavailable",
        comparisonLabel: "暂无",
        conclusion: `${options.specifiedPlatform}暂无可比价格。`,
        competitorCount: 0
      };
    }

    const qingmaoGap = qingmaoPrice - selectedCompetitorPrice;
    const comparisonLabel = specifiedPlatformLabel(options.specifiedPlatform, qingmaoGap);

    return {
      lowestPlatform: lowestOverall?.platform as PlatformName,
      qingmaoGap,
      comparisonBasis: "specifiedPlatform",
      comparisonLabel,
      conclusion: `青猫差旅${comparisonLabel}。`,
      competitorCount: 1
    };
  }

  if (competitors.length === 0) {
    return unavailableSummary();
  }

  const competitorPrices = competitors.map((quote) => quote.price ?? 0);
  const competitorCount = competitors.length;
  const lowestCompetitorPrice = Math.min(...competitorPrices);
  const highestCompetitorPrice = Math.max(...competitorPrices);

  if (options.comparisonMode === "external_sales") {
    if (qingmaoPrice <= lowestCompetitorPrice || qingmaoPrice >= highestCompetitorPrice) {
      const qingmaoGap = qingmaoPrice - average(competitorPrices);
      const comparisonLabel = averageComparisonLabel(qingmaoGap);

      return {
        lowestPlatform: lowestOverall?.platform as PlatformName,
        qingmaoGap,
        comparisonBasis: "competitorAverage",
        comparisonLabel,
        conclusion: `青猫差旅${comparisonLabel}。`,
        competitorCount
      };
    }

    const qingmaoGap = qingmaoPrice - lowestCompetitorPrice;
    const lowerThanHighestGap = highestCompetitorPrice - qingmaoPrice;
    const comparisonLabel = `高于竞品最低价${formatGap(qingmaoGap)}，同时低于竞品最高价${formatGap(lowerThanHighestGap)}`;

    return {
      lowestPlatform: lowestOverall?.platform as PlatformName,
      qingmaoGap,
      comparisonBasis: "competitorRange",
      comparisonLabel,
      conclusion: `青猫差旅${comparisonLabel}。`,
      competitorCount
    };
  }

  const qingmaoGap = qingmaoPrice - lowestCompetitorPrice;
  let comparisonLabel = "";

  if (qingmaoGap < 0) {
    comparisonLabel = `对比另外${competitorCount}家平台最低价低了${formatGap(qingmaoGap)}`;
  } else if (qingmaoGap > 0) {
    comparisonLabel = `对比另外${competitorCount}家平台最低价高了${formatGap(qingmaoGap)}`;
  } else {
    comparisonLabel = `与另外${competitorCount}家平台最低价持平`;
  }

  return {
    lowestPlatform: lowestOverall?.platform as PlatformName,
    qingmaoGap,
    comparisonBasis: "lowestCompetitor",
    comparisonLabel,
    conclusion: `青猫差旅${comparisonLabel}。`,
    competitorCount
  };
}

export function summarizeFlight(sample: FlightSample, options: PriceComparisonOptions | number = {}): FlightSummary {
  const available = availableQuotes(sample.quotes);
  const summary = summarizeQuoteSet(sample.quotes, typeof options === "number" ? {} : options);

  if (summary.qingmaoGap === null) {
    return {
      sampleId: sample.id,
      ...summary,
      availablePlatformCount: available.length,
      evidenceCount: comparisonQuotes(sample.quotes).filter((quote) => quote.evidencePath).length
    };
  }

  return {
    sampleId: sample.id,
    lowestPlatform: summary.lowestPlatform,
    qingmaoGap: summary.qingmaoGap,
    comparisonBasis: summary.comparisonBasis,
    comparisonLabel: summary.comparisonLabel,
    availablePlatformCount: available.length,
    evidenceCount: comparisonQuotes(sample.quotes).filter((quote) => quote.evidencePath).length,
    competitorCount: summary.competitorCount,
    conclusion: summary.conclusion
  };
}
