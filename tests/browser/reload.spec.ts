import { test, expect } from '@playwright/test';

test.describe('LiveStruct Page Reload Persistence', () => {
    test('write, flush, reload page restores value across host and child iframes', async ({ page }) => {
        await page.goto('/?split=dual');

        // Wait for store initialization in host and child iframes
        await page.waitForFunction(() => typeof window !== 'undefined' && Boolean(window.__cadStore));
        await expect(page.locator('[data-testid="dual-split-container"]')).toBeVisible();

        const frameA = page.frame({ url: /viewport=A/ });
        const frameB = page.frame({ url: /viewport=B/ });
        expect(frameA).toBeTruthy();
        expect(frameB).toBeTruthy();

        await frameA!.waitForFunction(() => typeof window !== 'undefined' && Boolean(window.__cadStore));
        await frameB!.waitForFunction(() => typeof window !== 'undefined' && Boolean(window.__cadStore));

        // Write and flush in iframe A
        const uniqueValue = 'Reload Persisted Circle ' + Date.now();
        await frameA!.evaluate(async (val) => {
            await window.__cadStore!.updateShapeProperties('circle-1', { name: val });
        }, uniqueValue);

        // Verify propagation before reload
        await expect.poll(async () => {
            return await frameB!.evaluate(() => window.__cadStore?.doc.data.shapes?.['circle-1']?.name);
        }, { timeout: 1000 }).toBe(uniqueValue);

        await expect.poll(async () => {
            return await page.evaluate(() => window.__cadStore?.doc.data.shapes?.['circle-1']?.name);
        }, { timeout: 1000 }).toBe(uniqueValue);

        // Reload the page
        await page.reload();

        // Wait for re-initialization
        await page.waitForFunction(() => typeof window !== 'undefined' && Boolean(window.__cadStore));
        await expect(page.locator('[data-testid="dual-split-container"]')).toBeVisible();

        const reloadedFrameA = page.frame({ url: /viewport=A/ });
        const reloadedFrameB = page.frame({ url: /viewport=B/ });
        expect(reloadedFrameA).toBeTruthy();
        expect(reloadedFrameB).toBeTruthy();

        await reloadedFrameA!.waitForFunction(() => typeof window !== 'undefined' && Boolean(window.__cadStore));
        await reloadedFrameB!.waitForFunction(() => typeof window !== 'undefined' && Boolean(window.__cadStore));

        // Verify data restored from OPFS SQLite across all three contexts
        const hostValue = await page.evaluate(() => window.__cadStore?.doc.data.shapes?.['circle-1']?.name);
        const frameAValue = await reloadedFrameA!.evaluate(() => window.__cadStore?.doc.data.shapes?.['circle-1']?.name);
        const frameBValue = await reloadedFrameB!.evaluate(() => window.__cadStore?.doc.data.shapes?.['circle-1']?.name);

        expect(hostValue).toBe(uniqueValue);
        expect(frameAValue).toBe(uniqueValue);
        expect(frameBValue).toBe(uniqueValue);

        // Confirm storage mode remained persisted
        const hostStorageMode = await page.evaluate(() => window.__cadStore?.liveStore.storageMode);
        expect(hostStorageMode).toBe('persisted');
    });
});
