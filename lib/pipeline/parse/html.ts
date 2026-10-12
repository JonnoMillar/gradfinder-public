/** HTML → readable plain text, preserving paragraph/list structure enough for an LLM to read. */
import * as cheerio from "cheerio";

export function htmlToText(html: string): string {
  const $ = cheerio.load(`<div id="__root">${html}</div>`);
  $("script,style,noscript,svg").remove();
  $("br").replaceWith("\n");
  $("li").each((_, el) => { $(el).prepend("• "); $(el).append("\n"); });
  $("p,div,h1,h2,h3,h4,h5,h6,tr,section,article,ul,ol").each((_, el) => { $(el).append("\n"); });
  const text = $("#__root").text();
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n").map((l) => l.trim()).join("\n")
    .trim();
}
