import json, sys, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / 'index.html').as_uri()
SHOTS = ROOT / 'tests' / 'shots'
SHOTS.mkdir(exist_ok=True)
DARK = '--dark' in sys.argv

MOCK = r"""
(() => {
  if (!localStorage.getItem('mockcloud')) localStorage.setItem('mockcloud', '{}');
  if (sessionStorage.getItem('wipeLocal')) {          // имитация другого устройства: локального зеркала нет
    for (const k of Object.keys(localStorage)) if (k.startsWith('gymlog')) localStorage.removeItem(k);
    sessionStorage.removeItem('wipeLocal');
  }
  const db = () => JSON.parse(localStorage.getItem('mockcloud'));
  const put = (d) => localStorage.setItem('mockcloud', JSON.stringify(d));
  const KEY = /^[A-Za-z0-9_-]{1,128}$/;
  window.__cloudErrors = [];
  const fail = (cb, msg) => { window.__cloudErrors.push(msg); setTimeout(() => cb(msg), 1); };
  const CS = {
    setItem(k, v, cb) {
      if (!KEY.test(k)) return fail(cb, 'KEY_INVALID ' + k);
      if (v.length > 4096) return fail(cb, 'VALUE_TOO_LONG ' + k + ' ' + v.length);
      const d = db(); d[k] = v;
      if (Object.keys(d).length > 1024) return fail(cb, 'STORAGE_KEY_LIMIT');
      put(d); setTimeout(() => cb(null, true), 2);
    },
    getItems(keys, cb) { const d = db(); const o = {}; keys.forEach(k => o[k] = d[k] ?? ''); setTimeout(() => cb(null, o), 2); },
    getKeys(cb) { setTimeout(() => cb(null, Object.keys(db())), 2); },
    removeItems(keys, cb) { const d = db(); keys.forEach(k => delete d[k]); put(d); setTimeout(() => cb(null, true), 2); },
  };
  const css = %CSS%;
  const applyCss = () => { for (const k in css) document.documentElement.style.setProperty(k, css[k]); };
  if (document.documentElement) applyCss(); else document.addEventListener('DOMContentLoaded', applyCss);
  window.Telegram = { WebApp: {
    initData: 'query_id=test', version: '8.0', CloudStorage: CS,
    isVersionAtLeast: (v) => parseFloat(v) <= 8.0,
    ready(){}, expand(){}, disableVerticalSwipes(){},
    BackButton: { show(){}, hide(){}, onClick(){} },
    HapticFeedback: { impactOccurred(){}, notificationOccurred(){} },
    showConfirm: (m, cb) => cb(true),
  }};
})();
"""
DARK_CSS = {
  '--tg-theme-bg-color': '#17212b', '--tg-theme-secondary-bg-color': '#0e1621', '--tg-theme-section-bg-color': '#17212b',
  '--tg-theme-text-color': '#f5f5f5', '--tg-theme-hint-color': '#708499', '--tg-theme-button-color': '#5288c1',
  '--tg-theme-button-text-color': '#ffffff', '--tg-theme-link-color': '#6ab3f3', '--tg-theme-destructive-text-color': '#ec3942',
}

IMPORT = (ROOT / 'tests' / 'sample.txt').read_text()

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        ctx.route('https://telegram.org/**', lambda r: r.abort())
        ctx.add_init_script(MOCK.replace('%CSS%', json.dumps(DARK_CSS if DARK else {})))
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: m.type == 'error' and 'ERR_FAILED' not in m.text and errors.append(m.text))
        page.goto(URL)
        page.wait_for_selector('.datebar')
        page.evaluate("window.__gym.date = '2026-11-12'")  # фиксируем «сегодня» для теста

        # 1. импорт старых записей
        page.click('[data-tab=m]')
        page.fill('#imp', IMPORT)
        page.click('[data-act=import]')
        res = page.inner_text('#impRes')
        print('IMPORT:', res.replace('\n', ' | '))
        assert 'Дней: 3' in res and 'упражнений: 19' in res, res

        # 2. новая тренировка: подсказка «прошлый раз» и предзаполнение
        page.click('[data-tab=w]')
        page.fill('#wTitle', 'Четверг')
        page.fill('#newEx', 'Жим лежа')
        page.click('[data-act=addex]')
        assert page.input_value('#sR') == '8' and page.input_value('#sW') == '25', (page.input_value('#sR'), page.input_value('#sW'))
        page.click('[data-act=step][data-id=sW][data-v="2.5"]')
        page.fill('#sN', '3')
        page.screenshot(path=str(SHOTS / ('set_sheet' + ('_dark' if DARK else '') + '.png')))
        page.click('[data-act=setsave]')
        chips = page.locator('.ex .chip:not(.add)').all_inner_texts()
        assert chips == ['8×27.5кг'] * 3, chips
        # quick text
        page.click('details summary')
        page.fill('#quick', 'Брусья - 4х20\nМахи в стороны - 12 15 15 10 6кг\nабракадабра')
        page.click('[data-act=quickadd]')
        assert 'абракадабра' in page.input_value('#quick')
        page.screenshot(path=str(SHOTS / ('workout' + ('_dark' if DARK else '') + '.png')), full_page=True)

        # 3. питание
        page.click('[data-tab=f]')
        page.fill('#fd-n', 'Гречка')
        page.fill('#fd-g', '150')
        page.fill('#fd-k', '343'); page.fill('#fd-p', '12.6'); page.fill('#fd-f', '3.3'); page.fill('#fd-c', '62')
        assert '515 ккал' in page.inner_text('#fPrev'), page.inner_text('#fPrev')
        page.click('[data-act=fsave]')
        page.click('[data-act=fmode][data-v=total]')
        page.fill('#fd-n', 'Протеин 1 скуп'); page.fill('#fd-p', '24'); page.fill('#fd-f', '1.5'); page.fill('#fd-c', '3')
        page.click('[data-act=fsave]')
        # продукт из списка: подставляет КБЖУ на 100 г
        page.click('[data-act=fmode][data-v="100"]')
        page.click('[data-act=fquick][data-n="Гречка"]')
        assert page.input_value('#fd-k') == '343'
        page.fill('#fd-g', '200')
        page.click('[data-act=fmeal][data-v="Ужин"]')
        page.fill('#fd-g', '200')
        page.click('[data-act=fsave]')
        kc = page.inner_text('.kcal-big b')
        print('KCAL today:', kc)
        assert kc == str(515 + round(4*24 + 9*1.5 + 4*3) + 686), kc
        page.screenshot(path=str(SHOTS / ('food' + ('_dark' if DARK else '') + '.png')), full_page=True)

        # 4. история / прогресс
        page.click('[data-tab=h]')
        page.screenshot(path=str(SHOTS / ('history' + ('_dark' if DARK else '') + '.png')), full_page=True)
        page.click('[data-act=hist][data-v=prog]')
        page.select_option('#statEx', 'жим лежа')
        page.screenshot(path=str(SHOTS / ('progress' + ('_dark' if DARK else '') + '.png')), full_page=True)
        page.click('[data-act=hist][data-v=food]')

        # 5. много данных -> куски по 4000 символов, затем загрузка «на другом устройстве»
        page.evaluate("""() => {
          const S = window.__gym;
          for (let i = 0; i < 31; i++) {
            const d = '2026-10-' + String(i + 1).padStart(2, '0');
            S.f[d] = { items: Array.from({length: 12}, (_, j) => ({ n: 'Очень длинное название блюда номер ' + j, g: 150, k: 300 + j, p: 20, f: 10, c: 30, m: 'Обед' })) };
          }
        }""")
        page.evaluate("document.querySelector('[data-tab=f]').click()")
        page.evaluate("window.__gym.date = '2026-10-05'")
        page.click('[data-act=dnext]')  # 06.10 -> добавим запись, чтобы сохранить месяц
        page.fill('#fd-n', 'Яблоко'); page.fill('#fd-g', '180'); page.fill('#fd-k', '52'); page.fill('#fd-p', '0.3'); page.fill('#fd-f', '0.2'); page.fill('#fd-c', '14')
        page.click('[data-act=fsave]')
        page.wait_for_timeout(1500)
        snapshot = page.evaluate("JSON.stringify({w: window.__gym.w, f: window.__gym.f, lib: window.__gym.lib})")
        keys = page.evaluate("Object.keys(JSON.parse(localStorage.getItem('mockcloud'))).sort()")
        print('CLOUD KEYS:', keys)
        assert any(k.startswith('f_202610--') for k in keys), 'ожидали разбиение на куски'
        assert page.evaluate('window.__cloudErrors') == [], page.evaluate('window.__cloudErrors')

        page.evaluate("sessionStorage.setItem('wipeLocal', '1')")
        page.reload()
        page.wait_for_selector('.datebar')
        after = page.evaluate("JSON.stringify({w: window.__gym.w, f: window.__gym.f, lib: window.__gym.lib})")
        assert json.loads(after) == json.loads(snapshot), 'данные после перезагрузки из облака отличаются'
        print('RELOAD FROM CLOUD: OK,', len(json.loads(after)['f']), 'дней питания,', len(json.loads(after)['w']), 'дней тренировок')

        # 6. удаление -> лишние куски должны исчезнуть
        page.evaluate("""() => { const S = window.__gym; for (const d in S.f) if (d.startsWith('2026-10') && d !== '2026-10-06') delete S.f[d]; }""")
        page.evaluate("window.__gym.date = '2026-10-06'; document.querySelector('[data-tab=f]').click()")
        page.click('[data-act=fdel][data-i="0"]')
        page.wait_for_timeout(800)
        keys = page.evaluate("Object.keys(JSON.parse(localStorage.getItem('mockcloud'))).sort()")
        print('CLOUD KEYS after delete:', keys)
        assert 'f_202610' in keys and not any(k.startswith('f_202610--') for k in keys), keys

        page.click('[data-tab=m]')
        page.click('[data-act=exptext]')
        print('EXPORT head:\n' + page.input_value('#out')[:400])
        page.screenshot(path=str(SHOTS / ('more' + ('_dark' if DARK else '') + '.png')), full_page=True)

        assert not errors, errors
        print('ALL OK')
        b.close()

main()
