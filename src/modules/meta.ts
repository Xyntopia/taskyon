import type { MetaOptions } from 'quasar/dist/types/meta.js';
import type { RouteLocationNormalizedLoadedGeneric } from 'vue-router';

export function generateTaskyonMeta(
  route: RouteLocationNormalizedLoadedGeneric,
) {
  const fallbackTitle = route.path.split('/').filter(Boolean).pop() ?? 'Main';
  const title = (route.meta.title as string) ?? fallbackTitle;

  const meta: MetaOptions = {
    // sets document title
    title,
    // optional; sets final title as "Index Page - My Website", useful for multiple level meta
    titleTemplate: (title: string) => `${title} - Taskyon`,

    // meta tags
    meta: {
      description: {
        name: 'description',
        content: route.meta.description ?? 'Taskyon AI Chat',
      },
      keywords: { name: 'keywords', content: 'Taskyon AI Chat' },
      equiv: {
        'http-equiv': 'Content-Type',
        content: 'text/html; charset=UTF-8',
      },
      // note: for Open Graph type metadata you will need to use SSR, to ensure page is rendered by the server
      ogTitle: {
        name: 'og:title',
        // optional; similar to titleTemplate, but allows templating with other meta properties
        template(ogTitle: string) {
          return `${ogTitle} - Taskyon`;
        },
      },
    },

    // CSS tags
    /*link: {
      material: {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/icon?family=Material+Icons',
      },
    },*/

    // JS tags
    script: {
      ldJson: {
        type: 'application/ld+json',
        innerHTML: '{ "@context": "http://schema.org" }',
      },
    },

    // <html> attributes
    /*htmlAttr: {
      'xmlns:cc': 'http://creativecommons.org/ns#', // generates <html xmlns:cc="http://creativecommons.org/ns#">,
      empty: undefined, // generates <html empty>
    },*/

    // <body> attributes
    /*bodyAttr: {
      'action-scope': 'xyz', // generates <body action-scope="xyz">
      empty: undefined, // generates <body empty>
    },*/

    // <noscript> tags
    noscript: {
      default: 'You need to enable Javascript for this webpage to work!!',
    },
  };
  return meta;
}
