import json, sys, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
URL = (ROOT / 'index.html').as_uri()
SHOTS = ROOT / 'tests' / 'shots'
SHOTS.mkdir(exist_ok=True)
DARK = '--dark' in sys.argv

MOCK = r"""
(() => {
  const KEY = /^[A-Za-z0-9_-]{1,128}$/;
  window.__cloudErrors = [];
  const call = (op, a) => window.cloudCall(op, JSON.stringify(a || {})).then(JSON.parse);
  const fail = (cb, msg) => { window.__cloudErrors.push(msg); setTimeout(() => cb(msg), 1); };
  const CS = {
    setItem(k, v, cb) {
      if (!KEY.test(k)) return fail(cb, 'KEY_INVALID ' + k);
      if (v.length > 4096) return fail(cb, 'VALUE_TOO_LONG ' + k + ' ' + v.length);
      call('set', { k, v }).then((r) => (r.err ? fail(cb, r.err) : cb(null, true)));
    },
    getItems(keys, cb) { call('get', { keys }).then((r) => cb(null, r)); },
    getKeys(cb) { call('keys').then((r) => cb(null, r)); },
    removeItems(keys, cb) { call('remove', { keys }).then(() => cb(null, true)); },
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
CLOUD = {}
def cloud_call(op, payload):
    a = json.loads(payload)
    if op == 'set':
        CLOUD[a['k']] = a['v']
        return json.dumps({'err': 'STORAGE_KEY_LIMIT'} if len(CLOUD) > 1024 else {})
    if op == 'get':
        return json.dumps({k: CLOUD.get(k, '') for k in a['keys']})
    if op == 'keys':
        return json.dumps(list(CLOUD))
    if op == 'remove':
        for k in a['keys']: CLOUD.pop(k, None)
        return '{}'

def new_context(b):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    ctx.route('https://telegram.org/**', lambda r: r.abort())
    ctx.expose_function('cloudCall', cloud_call)
    ctx.add_init_script(MOCK.replace('%CSS%', json.dumps(DARK_CSS if DARK else {})))
    return ctx

DARK_CSS = {
  '--tg-theme-bg-color': '#17212b', '--tg-theme-secondary-bg-color': '#0e1621', '--tg-theme-section-bg-color': '#17212b',
  '--tg-theme-text-color': '#f5f5f5', '--tg-theme-hint-color': '#708499', '--tg-theme-button-color': '#5288c1',
  '--tg-theme-button-text-color': '#ffffff', '--tg-theme-link-color': '#6ab3f3', '--tg-theme-destructive-text-color': '#ec3942',
}

IMPORT = (ROOT / 'tests' / 'sample.txt').read_text()

def go(page, d):
    page.evaluate(f"window.__gym.date = '{d}'")
    page.click('[data-act=dprev]'); page.click('[data-act=dnext]')

def S_date(page):
    return page.evaluate('window.__gym.date')

def main():
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = new_context(b).new_page()
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
        print('IMPORT:', repr(res))
        assert 'Дней: 3' in res and 'упражнений: 19' in res, res

        assert 'План на неделю создан из импорта: Ср, Пт, Вс' in res, res
        sfx = '_dark' if DARK else ''
        page.screenshot(path=str(SHOTS / f'plan_more{sfx}.png'), full_page=True)
        page.click('[data-tab=w]')
        kinds = page.eval_on_selector_all('.wk', 'els => els.map(e => e.className)')
        print('WEEK 09-15.11:', [k.split()[1] for k in kinds])
        assert [k.split()[1] for k in kinds] == ['k-rest','k-rest','k-plan','k-rest','k-plan','k-rest','k-plan'], kinds

        # 2a. четверг 12.11 — отдых → тренировка вне плана
        assert page.locator('[data-act=markx]').count() == 1 and page.locator('#newEx').count() == 0
        page.screenshot(path=str(SHOTS / f'rest_day{sfx}.png'))
        page.click('[data-act=markx]')
        assert 'вне плана' in page.inner_text('.banner')
        page.fill('#wTitle', 'Четверг')
        page.fill('#newEx', 'Жим лежа')
        page.click('[data-act=addex]')
        assert page.input_value('#sR') == '8' and page.input_value('#sW') == '25', (page.input_value('#sR'), page.input_value('#sW'))
        page.click('[data-act=step][data-id=sW][data-v="2.5"]')
        page.fill('#sN', '3')
        page.screenshot(path=str(SHOTS / f'set_sheet{sfx}.png'))
        page.click('[data-act=setsave]')
        chips = page.locator('.ex .chip:not(.add)').all_inner_texts()
        assert chips == ['8×27.5кг'] * 3, chips
        page.click('details summary')
        page.fill('#quick', 'Брусья - 4х20\nМахи в стороны - 12 15 15 10 6кг\nабракадабра')
        page.click('[data-act=quickadd]')
        assert 'абракадабра' in page.input_value('#quick')
        page.screenshot(path=str(SHOTS / f'workout{sfx}.png'), full_page=True)

        # 2b. среда 11.11 — по плану: упражнения из импорта, + новое упражнение в план
        page.click('[data-act=goday][data-d="2026-11-11"]')
        names = page.locator('.ex .ex-name').all_inner_texts()
        assert names == ['Жим лежа', 'Жим лежа(30°)', 'Разведенре гантелей лежа', 'Гантели на бицепс', 'Молотки на бицепс'], names
        page.locator('[data-act=addset]').nth(1).click()
        assert page.input_value('#sR') == '19' and page.input_value('#sW') == '20'
        page.click('[data-act=setsave]')
        page.fill('#newEx', 'Пуловер'); page.click('[data-act=addex]')
        page.fill('#sR', '12'); page.fill('#sW', '10'); page.click('[data-act=setsave]')
        page.screenshot(path=str(SHOTS / f'plan_day{sfx}.png'), full_page=True)
        assert page.evaluate("window.__gym.plan.days[3].ex.includes('Пуловер')")
        go(page, '2026-11-18')
        assert page.locator('.ex .ex-name').all_inner_texts()[-1] == 'Пуловер'

        # 2c. перенос пятницы 13.11 на субботу 14.11 и обратно
        go(page, '2026-11-13')
        page.click('[data-act=moveopen]')
        opts = page.locator('[data-act=moveto]').evaluate_all('els => els.map(e => e.dataset.d)')
        print('MOVE OPTIONS from 13.11:', opts)
        assert '2026-11-12' not in opts and '2026-11-11' not in opts and '2026-11-14' in opts and '2026-11-15' not in opts, opts
        page.screenshot(path=str(SHOTS / f'move_sheet{sfx}.png'))
        page.click('[data-act=moveto][data-d="2026-11-14"]')
        assert 'Перенесено с' in page.inner_text('.banner')
        assert page.locator('.ex .ex-name').first.inner_text() == 'Low Row machine'
        page.locator('[data-act=addset]').first.click(); page.click('[data-act=setsave]')
        page.screenshot(path=str(SHOTS / f'moved_to{sfx}.png'), full_page=True)
        page.click('[data-act=goday][data-d="2026-11-13"]')
        assert 'перенесена' in page.inner_text('.card.center')
        page.screenshot(path=str(SHOTS / f'moved_from{sfx}.png'))
        page.click('[data-act=unmove]')
        assert S_date(page) == '2026-11-13' and page.locator('.ex .chip:not(.add)').count() == 1, page.locator('.ex .chip:not(.add)').count()
        assert page.evaluate("!window.__gym.w['2026-11-13'].mv && !window.__gym.w['2026-11-14']?.from")

        # 2d. редактор плана: понедельник — тренировка
        page.click('[data-tab=m]')
        page.click('[data-act=pday][data-wd="1"]')
        page.click('[data-act=pon][data-v="1"]')
        page.fill('#pT', 'Спина'); page.fill('#pNew', 'Подтягивания'); page.press('#pNew', 'Enter')
        page.fill('#pNew', 'Тяга штанги'); page.click('[data-act=padd]')
        page.locator('[data-act=pmv][data-v="-1"]').nth(1).click()
        page.screenshot(path=str(SHOTS / f'plan_sheet{sfx}.png'))
        page.click('[data-act=psave]')
        assert page.evaluate("JSON.stringify(window.__gym.plan.days[1])") == '{"t":"Спина","ex":["Тяга штанги","Подтягивания"]}', page.evaluate("JSON.stringify(window.__gym.plan.days[1])")
        page.click('[data-tab=w]'); go(page, '2026-11-09')
        assert page.get_attribute('#wTitle', 'placeholder') == 'Спина'
        page.evaluate("window.__gym.date = '2026-11-12'")

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
        snapshot = page.evaluate("JSON.stringify({w: window.__gym.w, f: window.__gym.f, lib: window.__gym.lib, plan: window.__gym.plan})")
        keys = page.evaluate("0") or sorted(CLOUD)
        print('CLOUD KEYS:', keys)
        assert any(k.startswith('f_202610--') for k in keys), 'ожидали разбиение на куски'
        assert page.evaluate('window.__cloudErrors') == [], page.evaluate('window.__cloudErrors')

        # «другое устройство»: новый браузерный контекст без локальных данных, то же облако
        page = new_context(b).new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(URL)
        page.wait_for_selector('.datebar')
        after = page.evaluate("JSON.stringify({w: window.__gym.w, f: window.__gym.f, lib: window.__gym.lib, plan: window.__gym.plan})")
        def clean(x):
            x = json.loads(x)
            x['w'] = {d: v for d, v in x['w'].items() if v.get('t') or v.get('ex') or v.get('x') or v.get('mv') or v.get('from')}
            return x
        a_, s_ = clean(after), clean(snapshot)
        if a_ != s_:
            for k in s_:
                if a_[k] != s_[k]:
                    print('DIFF', k, {d: (s_[k].get(d), a_[k].get(d)) for d in set(s_[k]) | set(a_[k]) if s_[k].get(d) != a_[k].get(d)} if isinstance(s_[k], dict) else '')
        assert a_ == s_, 'данные после перезагрузки из облака отличаются'
        print('RELOAD FROM CLOUD: OK,', len(json.loads(after)['f']), 'дней питания,', len(json.loads(after)['w']), 'дней тренировок')

        # 6. удаление -> лишние куски должны исчезнуть
        page.evaluate("""() => { const S = window.__gym; for (const d in S.f) if (d.startsWith('2026-10') && d !== '2026-10-06') delete S.f[d]; }""")
        page.evaluate("window.__gym.date = '2026-10-06'; document.querySelector('[data-tab=f]').click()")
        page.click('[data-act=fdel][data-i="0"]')
        page.wait_for_timeout(800)
        keys = page.evaluate("0") or sorted(CLOUD)
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
