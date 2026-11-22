const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const html = readFileSync('public/index.html', 'utf8');
const start = html.indexOf('        async function syncLocalDataOnline()');
const end = html.indexOf('\n        }', start) + '\n        }'.length;
const syncSource = html.slice(start, end);

async function runSync(failAt) {
    const original = [{ id: 'oldest' }, { id: 'middle' }, { id: 'newest' }];
    const stored = new Map([['carreauxdas_custom_products', JSON.stringify(original)]]);
    const attempted = [];
    const context = vm.createContext({
        localStorage: {
            getItem: key => stored.get(key) ?? null,
            setItem: (key, value) => stored.set(key, value),
            removeItem: key => stored.delete(key),
        },
        products: [],
        publishProductOnline: async product => {
            attempted.push(product.id);
            if (product.id === failAt) throw new Error('Mot de passe incorrect');
            return product;
        },
        adminApi: async () => ({}),
        showToast() {}, renderProducts() {}, renderAdminStockList() {},
    });
    await vm.runInContext(`let syncingLocalData = false; ${syncSource}; syncLocalDataOnline()`, context);
    return { remaining: JSON.parse(stored.get('carreauxdas_custom_products') || '[]'), attempted };
}

test('authentication failure preserves every model that was not published', async () => {
    const result = await runSync('newest');
    assert.deepEqual(result.remaining.map(p => p.id), ['oldest', 'middle', 'newest']);
    assert.deepEqual(result.attempted, ['newest']);
});

test('partial success removes only confirmed models from the recovery copy', async () => {
    const result = await runSync('middle');
    assert.deepEqual(result.remaining.map(p => p.id), ['oldest', 'middle']);
    assert.deepEqual(result.attempted, ['newest', 'middle']);
});

test('successful recovery clears the local copy after server confirmation', async () => {
    const result = await runSync();
    assert.deepEqual(result.remaining, []);
    assert.equal(result.attempted.length, 3);
});

test('all inline scripts remain valid JavaScript', () => {
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
        if (!match[0].includes('type="application/ld+json"')) new vm.Script(match[1]);
    }
});

for (const [label, status, body, opens] of [
    ['accepted credentials', 200, { ok: true }, true],
    ['rejected credentials', 401, { error: 'refusé' }, false],
    ['server failure', 503, {}, false],
    ['unexpected response', 200, {}, false],
]) {
    test(`admin panel requires server confirmation: ${label}`, async () => {
        const elements = new Map();
        const element = id => {
            if (!elements.has(id)) elements.set(id, {
                value: 'test-input-only',
                hidden: id === 'admin-panel-view',
                classList: {
                    add() { elements.get(id).hidden = true; },
                    remove() { elements.get(id).hidden = false; },
                },
            });
            return elements.get(id);
        };
        element('admin-panel-view');
        const begin = html.indexOf('        async function verifyAdminLogin()');
        const finish = html.indexOf('\n        }', begin) + '\n        }'.length;
        const context = vm.createContext({
            document: { getElementById: element },
            fetch: async () => ({ ok: status === 200, status, json: async () => body }),
            showToast() {}, renderAdminStockList() {}, syncLocalDataOnline: async () => {},
        });
        await vm.runInContext(`let adminLoginPending = false; let adminOnlinePassword = ''; ${html.slice(begin, finish)}; verifyAdminLogin()`, context);
        assert.equal(!element('admin-panel-view').hidden, opens);
        if (opens) assert.equal(element('admin-pass-input').value, '');
    });
}

test('browser password defaults and local password setters have been removed', () => {
    assert.equal(html.includes('DEFAULT_ADMIN_PASSWORD'), false);
    assert.equal(/localStorage\.setItem\(['"]carreauxdas_admin_password/.test(html), false);
    assert.equal(html.includes('resetAdminPasswordToDefault'), false);
});
