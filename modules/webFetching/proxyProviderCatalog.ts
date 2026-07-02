export type ProxyAuthLocation = 'header' | 'query'

export type ProxyWebReaderArgs = {
  url: string
  providerPreset?: string
  serviceUrl?: string
  providerLabel?: string
  pricingUrl?: string
  docsUrl?: string
  apiKeySecretName?: string
  apiKeyHeader?: string
  apiKeyScheme?: string
  apiKeyLocation?: ProxyAuthLocation
  apiKeyQueryParam?: string
  onboardingToken?: string
  targetUrlParam?: string
}

export type ProxyProviderPreset = {
  label: string
  category: 'proxy-network' | 'web-unblocker' | 'scraping-api' | 'browser-scraping' | 'hybrid'
  pricingSummary: string
  pricingUrl: string
  docsUrl?: string
  defaultConfig?: Partial<
    Omit<ProxyWebReaderArgs, 'url' | 'providerPreset' | 'providerLabel' | 'pricingUrl' | 'docsUrl'>
  >
}

export type ResolvedProxyWebReaderArgs = Required<
  Pick<
    ProxyWebReaderArgs,
    | 'url'
    | 'providerLabel'
    | 'pricingUrl'
    | 'serviceUrl'
    | 'apiKeySecretName'
    | 'targetUrlParam'
    | 'apiKeyLocation'
  >
> &
  Pick<
    ProxyWebReaderArgs,
    'providerPreset' | 'docsUrl' | 'apiKeyHeader' | 'apiKeyScheme' | 'apiKeyQueryParam'
  >

const ensureNonEmptyString = (value: string | undefined, fieldName: string) => {
  const normalized = value?.trim() ?? ''
  if (normalized.length === 0) {
    throw new Error(`Missing required ${fieldName}.`)
  }
  return normalized
}

export const proxyWebReaderProviders = {
  iproyal_web_unblocker: {
    label: 'IPRoyal Web Unblocker',
    category: 'web-unblocker',
    pricingSummary:
      'Web Unblocker from $1.00 per 1,000 requests; residential proxies from $1.75/GB.',
    pricingUrl: 'https://iproyal.com/pricing/',
    docsUrl: 'https://docs.iproyal.com/',
  },
  webshare_rotating_residential: {
    label: 'Webshare Rotating Residential',
    category: 'proxy-network',
    pricingSummary:
      'Rotating residential proxies start at $2.75/GB monthly on 10 GB plans and scale lower with volume.',
    pricingUrl: 'https://www.webshare.io/pricing',
    docsUrl: 'https://help.webshare.io/',
  },
  decodo_residential: {
    label: 'Decodo Residential Proxies',
    category: 'proxy-network',
    pricingSummary:
      'Residential proxies start at $2/GB; visible plan examples include $3.50/GB on 10 GB.',
    pricingUrl: 'https://decodo.com/proxies/residential-proxies/pricing',
    docsUrl: 'https://help.decodo.com/',
  },
  oxylabs_web_scraper_api: {
    label: 'Oxylabs Web Scraper API',
    category: 'scraping-api',
    pricingSummary:
      'Web Scraper API starts from $0.25 per 1,000 results; residential proxies start from $6/GB.',
    pricingUrl: 'https://oxylabs.io/pricing',
    docsUrl: 'https://developers.oxylabs.io/',
  },
  bright_data_unlocker: {
    label: 'Bright Data Unlocker API',
    category: 'web-unblocker',
    pricingSummary:
      'Unlocker API starts from $1 per 1,000 requests; page pricing shows $1.5 per 1,000 PAYG.',
    pricingUrl: 'https://brightdata.com/pricing/web-unlocker',
    docsUrl: 'https://docs.brightdata.com/',
  },
  zyte_api: {
    label: 'Zyte API',
    category: 'browser-scraping',
    pricingSummary:
      'Pay-as-you-go HTTP responses run from $0.13 to $1.27 per 1,000 requests; browser-rendered from $1.01 to $16.08.',
    pricingUrl: 'https://www.zyte.com/pricing/',
    docsUrl: 'https://docs.zyte.com/',
  },
  scrapingbee_api: {
    label: 'ScrapingBee API',
    category: 'scraping-api',
    pricingSummary:
      'Freelance plan is $49/month for 250,000 API credits; Startup is $99/month for 1,000,000.',
    pricingUrl: 'https://www.scrapingbee.com/pricing/',
    docsUrl: 'https://www.scrapingbee.com/documentation/',
  },
  scraperapi: {
    label: 'ScraperAPI',
    category: 'scraping-api',
    pricingSummary:
      'Hobby plan is $49/month for 100,000 API credits; Startup is $149/month for 1,000,000.',
    pricingUrl: 'https://www.scraperapi.com/pricing/',
    docsUrl: 'https://docs.scraperapi.com/',
    defaultConfig: {
      serviceUrl: 'https://api.scraperapi.com/',
      apiKeyLocation: 'query',
      apiKeyQueryParam: 'api_key',
      targetUrlParam: 'url',
      apiKeySecretName: 'API_KEY',
    },
  },
  zenrows: {
    label: 'ZenRows',
    category: 'hybrid',
    pricingSummary: 'Developer starts at $69/month; Startup $129/month; Business $299/month.',
    pricingUrl: 'https://www.zenrows.com/pricing',
    docsUrl: 'https://docs.zenrows.com/',
  },
  crawlbase: {
    label: 'Crawlbase',
    category: 'scraping-api',
    pricingSummary:
      'Cloud Storage Developer is $29/month for 100k requests; LinkedIn crawler pricing is listed at $15 per 1,000 successful crawls.',
    pricingUrl: 'https://crawlbase.com/pricing',
    docsUrl: 'https://crawlbase.com/docs/',
  },
  rayobyte_web_unblocker: {
    label: 'Rayobyte Web Unblocker',
    category: 'web-unblocker',
    pricingSummary: 'Web Unblocker starts at $6/GB, dropping to $3.50/GB on larger plans.',
    pricingUrl: 'https://rayobyte.com/pricing/',
    docsUrl: 'https://rayobyte.com/blog/',
  },
  soax_web_data_api: {
    label: 'SOAX Web Data API',
    category: 'hybrid',
    pricingSummary:
      'Web Data API starts from $0.90 per 1,000 requests; enterprise proxy rates start at $0.32/GB.',
    pricingUrl: 'https://www.soax.com/pricing',
    docsUrl: 'https://helpcenter.soax.com/',
  },
  infatica_residential: {
    label: 'Infatica Residential Proxies',
    category: 'proxy-network',
    pricingSummary: 'Residential proxies are $4/GB PAYG and reach $2.32/GB on larger plans.',
    pricingUrl: 'https://infatica.io/pricing/',
    docsUrl: 'https://docs.infatica.io/',
  },
  shifter_scraping_api: {
    label: 'Shifter Web Scraping API',
    category: 'scraping-api',
    pricingSummary:
      'Web Scraping API starts at $44/month; residential proxies start from $0.75/GB.',
    pricingUrl: 'https://shifter.io/pricing',
    docsUrl: 'https://developers.shifter.io/',
  },
  proxyscrape_residential: {
    label: 'ProxyScrape Rotating Residential',
    category: 'proxy-network',
    pricingSummary:
      'Pricing examples include 10 GB for $35.5 and 250 GB monthly plans shown via the live calculator.',
    pricingUrl: 'https://proxyscrape.com/pricing',
    docsUrl: 'https://docs.proxyscrape.com/',
  },
  packetstream_residential: {
    label: 'PacketStream Residential',
    category: 'proxy-network',
    pricingSummary: 'Residential proxy access is a flat $1.00/GB pay-as-you-go.',
    pricingUrl: 'https://packetstream.io/pricing/',
    docsUrl: 'https://packetstream.io/',
  },
  instantproxies_residential: {
    label: 'InstantProxies Residential',
    category: 'proxy-network',
    pricingSummary:
      'Residential proxies are $1/GB starting at $10 monthly; datacenter proxies start at $1 per proxy.',
    pricingUrl: 'https://instantproxies.com/pricing/',
    docsUrl: 'https://instantproxies.com/',
  },
  geonode_scraper_api: {
    label: 'Geonode Scraper API',
    category: 'hybrid',
    pricingSummary:
      'Scraper API starts from $0.13 per 1,000 requests; residential proxies start from $0.27/GB.',
    pricingUrl: 'https://geonode.com/pricing',
    docsUrl: 'https://docs.geonode.com/',
  },
  liveproxies_residential: {
    label: 'Live Proxies Rotating Residential',
    category: 'proxy-network',
    pricingSummary: 'Entry rotating residential plans start at $70 for 4 GB over 30 days.',
    pricingUrl: 'https://liveproxies.io/pricing',
    docsUrl: 'https://helpcenter.liveproxies.io/',
  },
  evomi_core_residential: {
    label: 'Evomi Core Residential',
    category: 'proxy-network',
    pricingSummary: 'Core residential proxies are $0.49/GB PAYG or $49.99/month for 100 GB.',
    pricingUrl: 'https://evomi.com/pricing',
    docsUrl: 'https://evomi.com/',
  },
  apify_proxy: {
    label: 'Apify Proxy',
    category: 'browser-scraping',
    pricingSummary:
      'Apify paid plans start at $29/month plus pay-as-you-go; residential proxies are listed from $8/GB on the pricing page.',
    pricingUrl: 'https://apify.com/pricing',
    docsUrl: 'https://docs.apify.com/',
  },
  dataimpulse_residential: {
    label: 'DataImpulse Residential',
    category: 'proxy-network',
    pricingSummary:
      'Recent public pricing coverage reports residential proxy traffic starting at $1/GB with pay-as-you-go billing.',
    pricingUrl: 'https://dataimpulse.com/',
    docsUrl: 'https://dataimpulse.com/',
  },
  storm_proxies: {
    label: 'Storm Proxies',
    category: 'proxy-network',
    pricingSummary:
      'Public review coverage lists rotating residential access from $19/month for 1 port and dedicated datacenter from $10/month for 5 IPs.',
    pricingUrl: 'https://stormproxies.com/',
    docsUrl: 'https://stormproxies.com/',
  },
  proxyempire_residential: {
    label: 'ProxyEmpire Residential',
    category: 'proxy-network',
    pricingSummary:
      'Public review coverage lists a $1.97 paid trial and pay-as-you-go rotating residential traffic from $7/GB.',
    pricingUrl: 'https://proxyempire.io/',
    docsUrl: 'https://proxyempire.io/',
  },
  netnut_residential: {
    label: 'NetNut',
    category: 'hybrid',
    pricingSummary:
      'NetNut provides public product and sales information; current entry pricing should be checked on the vendor pricing page.',
    pricingUrl: 'https://netnut.io/pricing/',
    docsUrl: 'https://netnut.io/',
  },
  nimbleway_platform: {
    label: 'Nimble',
    category: 'hybrid',
    pricingSummary:
      'Nimble publishes product-led scraping infrastructure; current plan pricing should be checked on the vendor pricing page.',
    pricingUrl: 'https://nimbleway.com/pricing/',
    docsUrl: 'https://docs.nimbleway.com/',
  },
  proxycheap_residential: {
    label: 'Proxy-Cheap',
    category: 'proxy-network',
    pricingSummary:
      'Proxy-Cheap publishes self-serve proxy plans; verify the current entry tier on the pricing page before selecting it.',
    pricingUrl: 'https://proxy-cheap.com/pricing',
    docsUrl: 'https://proxy-cheap.com/',
  },
  asocks_residential: {
    label: 'ASocks',
    category: 'proxy-network',
    pricingSummary:
      'ASocks offers self-serve residential/mobile/ISP proxy products; check the pricing page for current pay-as-you-go entry rates.',
    pricingUrl: 'https://asocks.com/pricing',
    docsUrl: 'https://asocks.com/',
  },
  marsproxies_residential: {
    label: 'MarsProxies',
    category: 'proxy-network',
    pricingSummary:
      'MarsProxies publishes residential, ISP, and datacenter plans; check the pricing page for the current entry plan.',
    pricingUrl: 'https://marsproxies.com/pricing',
    docsUrl: 'https://marsproxies.com/',
  },
  lunaproxy_residential: {
    label: 'LunaProxy',
    category: 'proxy-network',
    pricingSummary:
      'LunaProxy publishes residential and mobile proxy pricing publicly; verify the current entry rate on the pricing page.',
    pricingUrl: 'https://lunaproxy.com/pricing',
    docsUrl: 'https://lunaproxy.com/',
  },
  proxyrack: {
    label: 'ProxyRack',
    category: 'proxy-network',
    pricingSummary:
      'ProxyRack offers rotating residential and datacenter proxy products; check the pricing page for the current entry tier.',
    pricingUrl: 'https://www.proxyrack.com/pricing',
    docsUrl: 'https://www.proxyrack.com/',
  },
  proxyseller: {
    label: 'Proxy-Seller',
    category: 'proxy-network',
    pricingSummary:
      'Proxy-Seller offers residential, mobile, ISP, and datacenter proxies with public pricing; verify the current entry tier on the pricing page.',
    pricingUrl: 'https://proxy-seller.com/pricing',
    docsUrl: 'https://proxy-seller.com/',
  },
  hydraproxy: {
    label: 'HydraProxy',
    category: 'proxy-network',
    pricingSummary:
      'HydraProxy publishes residential/mobile/ISP proxy plans; verify the current entry plan on the pricing page.',
    pricingUrl: 'https://www.hydraproxy.com/pricing/',
    docsUrl: 'https://www.hydraproxy.com/',
  },
  myprivateproxy: {
    label: 'MyPrivateProxy',
    category: 'proxy-network',
    pricingSummary:
      'MyPrivateProxy focuses on private datacenter proxies with public plan pricing; check the pricing page for the current entry tier.',
    pricingUrl: 'https://www.myprivateproxy.net/proxy-pricing',
    docsUrl: 'https://www.myprivateproxy.net/',
  },
  squidproxies: {
    label: 'SquidProxies',
    category: 'proxy-network',
    pricingSummary:
      'SquidProxies publishes private proxy plans with monthly pricing; verify the current entry tier on the pricing page.',
    pricingUrl: 'https://www.squidproxies.com/pricing.php',
    docsUrl: 'https://www.squidproxies.com/',
  },
  privateproxy_me: {
    label: 'PrivateProxy.me',
    category: 'proxy-network',
    pricingSummary:
      'PrivateProxy.me offers private and rotating proxy products; check the pricing page for current entry pricing.',
    pricingUrl: 'https://privateproxy.me/pricing/',
    docsUrl: 'https://privateproxy.me/',
  },
  nodemaven_residential: {
    label: 'NodeMaven',
    category: 'proxy-network',
    pricingSummary:
      'NodeMaven publishes residential/mobile/static-residential plans; verify the current entry rate on the pricing page.',
    pricingUrl: 'https://nodemaven.com/pricing',
    docsUrl: 'https://nodemaven.com/',
  },
  okeyproxy_residential: {
    label: 'OkeyProxy',
    category: 'proxy-network',
    pricingSummary:
      'OkeyProxy offers public residential and datacenter proxy pricing; verify the current entry tier on the pricing page.',
    pricingUrl: 'https://www.okeyproxy.com/pricing/',
    docsUrl: 'https://www.okeyproxy.com/',
  },
  spaceproxy: {
    label: 'SpaceProxy',
    category: 'proxy-network',
    pricingSummary:
      'SpaceProxy publishes proxy plan pricing publicly; verify the current entry tier on the pricing page.',
    pricingUrl: 'https://spaceproxy.net/en/pricing',
    docsUrl: 'https://spaceproxy.net/en/',
  },
  rampage_proxies: {
    label: 'Rampage Proxies',
    category: 'proxy-network',
    pricingSummary:
      'Rampage Proxies resells multiple proxy/network options and publishes plans publicly; verify the current entry tier on the pricing page.',
    pricingUrl: 'https://rampageproxies.com/pricing',
    docsUrl: 'https://rampageproxies.com/',
  },
  residentialproxies: {
    label: 'ResidentialProxies.com',
    category: 'proxy-network',
    pricingSummary:
      'ResidentialProxies.com publishes residential and static residential products; verify the current entry pricing on the vendor site.',
    pricingUrl: 'https://residentialproxies.com/pricing/',
    docsUrl: 'https://residentialproxies.com/',
  },
} as const satisfies Record<string, ProxyProviderPreset>

export const proxyWebReaderProviderIds = Object.keys(proxyWebReaderProviders)

const proxyWebReaderProviderMap: Readonly<Record<string, ProxyProviderPreset>> =
  proxyWebReaderProviders

export const resolveProxyProviderPreset = (providerPreset: string | undefined) => {
  if (!providerPreset) return undefined
  return proxyWebReaderProviderMap[providerPreset]
}

export const resolveProxyWebReaderArgs = (args: ProxyWebReaderArgs): ResolvedProxyWebReaderArgs => {
  const preset = resolveProxyProviderPreset(args.providerPreset)
  const defaultConfig = preset?.defaultConfig ?? {}
  const providerPreset = args.providerPreset?.trim()
  const docsUrl = args.docsUrl?.trim() || preset?.docsUrl
  const apiKeyHeader = args.apiKeyHeader?.trim() || defaultConfig.apiKeyHeader
  const apiKeyScheme = args.apiKeyScheme?.trim() || defaultConfig.apiKeyScheme
  const apiKeyQueryParam = args.apiKeyQueryParam?.trim() || defaultConfig.apiKeyQueryParam
  return {
    url: ensureNonEmptyString(args.url, 'url'),
    providerLabel: args.providerLabel?.trim() || preset?.label || 'configured proxy service',
    pricingUrl: args.pricingUrl?.trim() || preset?.pricingUrl || '',
    serviceUrl: args.serviceUrl?.trim() || defaultConfig.serviceUrl || '',
    apiKeySecretName: args.apiKeySecretName?.trim() || defaultConfig.apiKeySecretName || 'API_KEY',
    apiKeyLocation: args.apiKeyLocation || defaultConfig.apiKeyLocation || 'header',
    targetUrlParam: args.targetUrlParam?.trim() || defaultConfig.targetUrlParam || 'url',
    ...(providerPreset ? { providerPreset } : {}),
    ...(docsUrl ? { docsUrl } : {}),
    ...(apiKeyHeader ? { apiKeyHeader } : {}),
    ...(apiKeyScheme ? { apiKeyScheme } : {}),
    ...(apiKeyQueryParam ? { apiKeyQueryParam } : {}),
  }
}
