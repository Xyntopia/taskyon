import { proxyWebReaderProviders } from './proxyProviderCatalog'

export type McpCapableWebProvider = {
  providerId: string
  label: string
  category: 'scraping-api' | 'browser-scraping' | 'web-unblocker' | 'hybrid'
  pricingSummary: string
  pricingUrl: string
  docsUrl?: string
  integrationStyle: 'http-api' | 'browser-api' | 'hybrid-api'
  notes: string
  recommendedForTaskyonDefault: boolean
}

const createMcpCapableWebProvider = (
  providerId: string,
  integrationStyle: McpCapableWebProvider['integrationStyle'],
  notes: string,
  recommendedForTaskyonDefault = false,
): McpCapableWebProvider => {
  const provider = proxyWebReaderProviders[providerId as keyof typeof proxyWebReaderProviders]
  if (!provider) {
    throw new Error(`Unknown proxy provider preset "${providerId}".`)
  }
  if (provider.category === 'proxy-network') {
    throw new Error(`Provider "${providerId}" is a raw proxy network, not an MCP-style API.`)
  }

  return {
    providerId,
    label: provider.label,
    category: provider.category,
    pricingSummary: provider.pricingSummary,
    pricingUrl: provider.pricingUrl,
    docsUrl: provider.docsUrl,
    integrationStyle,
    notes,
    recommendedForTaskyonDefault,
  }
}

export const mcpCapableWebProviders = [
  createMcpCapableWebProvider(
    'scraperapi',
    'http-api',
    'Simple HTTP scraping API with direct URL fetch semantics. Good first default for Taskyon onboarding.',
    true,
  ),
  createMcpCapableWebProvider(
    'geonode_scraper_api',
    'hybrid-api',
    'Cheap scraping API plus cheap residential proxy network. Strong low-cost MCP candidate.',
  ),
  createMcpCapableWebProvider(
    'zyte_api',
    'browser-api',
    'Well-suited when you need rendered pages, anti-bot handling, or richer extraction flows.',
  ),
  createMcpCapableWebProvider(
    'bright_data_unlocker',
    'http-api',
    'Commercial unblocker API. Strong reliability, but pricing is usually above the lowest-cost options.',
  ),
  createMcpCapableWebProvider(
    'iproyal_web_unblocker',
    'http-api',
    'Unblocker-style API with a lower request entry point than many enterprise vendors.',
  ),
  createMcpCapableWebProvider(
    'oxylabs_web_scraper_api',
    'http-api',
    'Scraper API with structured extraction focus and a higher enterprise-oriented proxy baseline.',
  ),
  createMcpCapableWebProvider(
    'scrapingbee_api',
    'http-api',
    'Simple API surface with bundled rendering and rotating infrastructure.',
  ),
  createMcpCapableWebProvider(
    'crawlbase',
    'http-api',
    'Request-based scraping API that can be wrapped cleanly behind an MCP tool.',
  ),
  createMcpCapableWebProvider(
    'soax_web_data_api',
    'hybrid-api',
    'API surface plus broader proxy platform. Useful when you may later outgrow the single API endpoint.',
  ),
  createMcpCapableWebProvider(
    'shifter_scraping_api',
    'http-api',
    'Simple scraping API with an optional lower-cost residential proxy path.',
  ),
  createMcpCapableWebProvider(
    'zenrows',
    'hybrid-api',
    'Convenient anti-bot scraping API with higher entry subscription pricing.',
  ),
  createMcpCapableWebProvider(
    'rayobyte_web_unblocker',
    'http-api',
    'Web unblocker product; more expensive than the lowest-cost scraping APIs.',
  ),
  createMcpCapableWebProvider(
    'apify_proxy',
    'browser-api',
    'Better fit when you want actor-style automation or hosted browser workflows behind MCP.',
  ),
] as const satisfies readonly McpCapableWebProvider[]

export const mcpCapableWebProviderIds = mcpCapableWebProviders.map(
  (provider) => provider.providerId,
)

export const defaultMcpCapableWebProvider =
  mcpCapableWebProviders.find((provider) => provider.recommendedForTaskyonDefault) ??
  mcpCapableWebProviders[0]
