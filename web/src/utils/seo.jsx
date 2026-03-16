import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';

export function useSEO({ title, description, path }) {
  const fullTitle = title ? `${title} | Awardopedia` : 'Awardopedia — Federal Contract Awards';
  const desc = description || 'Search and analyze federal contract awards from USASpending.gov. Free access to government contract data.';
  const url = path ? `https://awardopedia.com${path}` : 'https://awardopedia.com';

  return {
    SEOHead: () => (
      <Helmet>
        <title>{fullTitle}</title>
        <meta name="description" content={desc} />
        <link rel="canonical" href={url} />
        <meta property="og:title" content={fullTitle} />
        <meta property="og:description" content={desc} />
        <meta property="og:url" content={url} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={fullTitle} />
        <meta name="twitter:description" content={desc} />
      </Helmet>
    ),
  };
}
