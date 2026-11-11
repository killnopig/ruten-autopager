// ==UserScript==
// @name         露天賣場自動翻頁
// @namespace    https://github.com/killnopig
// @version      1.1
// @description  露天拍賣賣場頁捲到底自動載入下一頁，不用 iframe，速度和露天本身一樣快
// @match        https://www.ruten.com.tw/store/*
// @run-at       document-idle
// @grant        none
// @homepageURL  https://github.com/killnopig/ruten-autopager
// @updateURL    https://raw.githubusercontent.com/killnopig/ruten-autopager/main/ruten-autopager.user.js
// @downloadURL  https://raw.githubusercontent.com/killnopig/ruten-autopager/main/ruten-autopager.user.js
// ==/UserScript==

(function () {
  'use strict';

  const LIST = '.rt-store-product-list-main';
  const NEXT_LI = '.rt-pagination li.next';
  const PAGE_INFO = '.page-info-pagenum';
  const TRIGGER_SCREENS = 1.5; // 距離列表底部還剩幾個螢幕高就先載入
  const TIMEOUT = 10000;

  let acc = null;
  let loading = false;
  // 網址扣掉頁碼 p 之後的部分：變了代表使用者換了分類、排序或搜尋
  const baseKey = () => {
    const u = new URL(location.href);
    u.searchParams.delete('p');
    u.searchParams.sort();
    return u.pathname.replace(/\/list\/?$/, '/').replace(/\/?$/, '/') + '?' + u.searchParams;
  };
  let lastKey = baseKey();
  let graceUntil = 0; // 自己翻頁後網址會晚一點才變，這段時間內不算使用者換分類

  const log = (...a) => console.log('[自動翻頁]', ...a);

  // 真正的商品列表（排除我們複製到累積區塊裡的那些）
  function getList() {
    return [...document.querySelectorAll(LIST)].find((l) => !l.closest('#rtap-acc')) || null;
  }

  function pageNum() {
    const m = (document.querySelector(PAGE_INFO)?.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
    return m ? { cur: +m[1], total: +m[2] } : null;
  }

  function firstHref(list) {
    return list?.querySelector('a[href*="/item/"]')?.href || '';
  }

  function hasNext() {
    const li = document.querySelector(NEXT_LI);
    if (!li || /\b(current|disable)\b/.test(li.className)) return false;
    const p = pageNum();
    return !p || p.cur < p.total;
  }

  function ensureAcc(list) {
    if (acc && acc.isConnected) {
      if (acc.nextElementSibling !== list) list.parentNode.insertBefore(acc, list);
      return acc;
    }
    acc = document.createElement('div');
    acc.id = 'rtap-acc';
    list.parentNode.insertBefore(acc, list);
    return acc;
  }

  function separator(n) {
    const d = document.createElement('div');
    d.textContent = `— 第 ${n} 頁 —`;
    d.style.cssText = 'margin:16px 0;padding:6px 0;text-align:center;color:#888;font-size:14px;border-top:1px dashed #ccc;border-bottom:1px dashed #ccc;';
    return d;
  }

  // 載入中暫時停用網站的捲動，避免換頁時跳回列表頂端
  const orig = {
    scrollTo: window.scrollTo,
    scroll: window.scroll,
    scrollIntoView: Element.prototype.scrollIntoView,
    elScrollTo: Element.prototype.scrollTo,
  };
  function lockScroll() {
    const noop = function () {};
    window.scrollTo = window.scroll = noop;
    Element.prototype.scrollIntoView = noop;
    Element.prototype.scrollTo = noop;
  }
  function unlockScroll() {
    window.scrollTo = orig.scrollTo;
    window.scroll = orig.scroll;
    Element.prototype.scrollIntoView = orig.scrollIntoView;
    Element.prototype.scrollTo = orig.elScrollTo;
  }

  function loadNext() {
    const list = getList();
    const nextA = document.querySelector(NEXT_LI + ' a');
    if (!list || !nextA || !firstHref(list)) return;

    loading = true;
    const before = pageNum();
    const beforeHref = firstHref(list);
    const y = window.scrollY;
    const t0 = performance.now();

    // 把目前這頁的商品複製一份留在列表上方
    const snap = list.cloneNode(true);
    snap.removeAttribute('id');
    snap.classList.add('rtap-page');
    const box = ensureAcc(list);
    if (!box.children.length && before) box.appendChild(separator(before.cur));
    box.appendChild(snap);
    const sep = separator(before ? before.cur + 1 : '?');
    box.appendChild(sep);

    list.style.minHeight = list.offsetHeight + 'px';
    lockScroll();
    nextA.click();

    const done = (ok) => {
      clearInterval(timer);
      unlockScroll();
      list.style.minHeight = '';
      if (window.scrollY !== y) orig.scrollTo.call(window, 0, y);
      if (!ok) { snap.remove(); sep.remove(); }
      loading = false;
      graceUntil = performance.now() + 1500;
      lastKey = baseKey();
      log(ok ? `載入第 ${pageNum()?.cur} 頁，${Math.round(performance.now() - t0)} ms` : '載入逾時');
      if (ok) setTimeout(check, 300);
    };

    const timer = setInterval(() => {
      const cur = getList();
      const p = pageNum();
      const changed = cur && cur.children.length && firstHref(cur) !== beforeHref &&
        (!before || (p && p.cur !== before.cur));
      if (changed) {
        // 等下一個畫面更新後再放開捲動鎖定
        requestAnimationFrame(() => done(true));
        clearInterval(timer);
      } else if (performance.now() - t0 > TIMEOUT) {
        done(false);
      }
    }, 30);
  }

  function check() {
    if (loading) return;
    const list = getList();
    if (!list || !hasNext()) return;
    const remain = list.getBoundingClientRect().bottom - window.innerHeight;
    if (remain < window.innerHeight * TRIGGER_SCREENS) loadNext();
  }

  // 使用者自己換分類、排序、搜尋時，清掉已累積的頁面
  setInterval(() => {
    const k = baseKey();
    if (k === lastKey) return;
    lastKey = k;
    if (loading || performance.now() < graceUntil) return;
    if (acc) {
      acc.remove();
      acc = null;
      log('換了分類或排序，重設');
    }
  }, 300);

  // 已經捲到底就不會再有 scroll 事件，定時補檢查一次
  setInterval(check, 800);

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; check(); });
  }, { passive: true });
})();
