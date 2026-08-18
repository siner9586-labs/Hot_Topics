export const GET=()=>new Response('User-agent: *\nAllow: /\nDisallow: /search?\nSitemap: /sitemap.xml\n',{headers:{'content-type':'text/plain; charset=utf-8'}});
