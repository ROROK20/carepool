/**
 * The large-text setting. One class on <html> bumps the root font size and
 * line height (globals.css); every size in the app is in rem, so everything
 * scales with it. The choice is remembered per device in localStorage.
 *
 * LARGE_TEXT_SCRIPT runs inline in <head>, before <body> is parsed, so a page
 * never paints at the small size first. Storage can be blocked (private
 * modes, strict settings): every access is wrapped, and the page then simply
 * starts at the normal size.
 */

export const LARGE_TEXT_CLASS = "large-text";
export const LARGE_TEXT_KEY = "carepool:large-text";

export const LARGE_TEXT_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(LARGE_TEXT_KEY)})==="1")document.documentElement.classList.add(${JSON.stringify(LARGE_TEXT_CLASS)})}catch(e){}`;
