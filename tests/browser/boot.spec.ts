import { test, expect } from '@playwright/test';

test.describe('LiveStruct Browser Boot', () => {
    test('boots with persisted OPFS storageMode and zero console errors', async ({ page }) => {
        const consoleErrors: string[] = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            }
        });
        page.on('pageerror', (err) => {
            consoleErrors.push(err.message);
        });

        await page.goto('/');

        // Wait for store initialization
        await page.waitForFunction(() => typeof window !== 'undefined' && Boolean(window.__cadStore));

        // Check storage mode is persisted
        const storageMode = await page.evaluate(() => window.__cadStore?.liveStore.storageMode);
        expect(storageMode).toBe('persisted');

        // Confirm UI rendered
        await expect(page.locator('[data-testid="host-shell"]')).toBeVisible();
        await expect(page.locator('[data-testid="single-viewport-container"]')).toBeVisible();

        // Verify zero console or page errors
        expect(consoleErrors).toEqual([]);
    });
});
