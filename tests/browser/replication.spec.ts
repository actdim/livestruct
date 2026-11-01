import { test, expect } from '@playwright/test';

test.describe('LiveStruct Multi-Context Replication', () => {
    test('propagates writes from iframe A to iframe B and host within 500ms', async ({ page }) => {
        await page.goto('/?split=dual');

        // Wait for host shell and dual split container
        await page.waitForFunction(() => typeof window !== 'undefined' && Boolean(window.__cadStore));
        await expect(page.locator('[data-testid="dual-split-container"]')).toBeVisible();

        // Resolve frame contexts for Viewport A and Viewport B
        const frameAElement = page.locator('[data-testid="iframe-viewport-a"]');
        const frameBElement = page.locator('[data-testid="iframe-viewport-b"]');
        await expect(frameAElement).toBeVisible();
        await expect(frameBElement).toBeVisible();

        const frameA = page.frame({ url: /viewport=A/ });
        const frameB = page.frame({ url: /viewport=B/ });
        expect(frameA).toBeTruthy();
        expect(frameB).toBeTruthy();

        // Wait for CAD stores in both child frames
        await frameA!.waitForFunction(() => typeof window !== 'undefined' && Boolean(window.__cadStore));
        await frameB!.waitForFunction(() => typeof window !== 'undefined' && Boolean(window.__cadStore));

        // Perform write in iframe A
        const updatedName = 'Replicated Frame ' + Date.now();
        await frameA!.evaluate(async (newName) => {
            await window.__cadStore!.updateShapeProperties('rect-1', { name: newName });
        }, updatedName);

        // Verify propagation to iframe B within 500ms
        await expect.poll(async () => {
            return await frameB!.evaluate(() => window.__cadStore?.doc.data.shapes?.['rect-1']?.name);
        }, {
            timeout: 500,
            intervals: [20, 50, 100],
            message: 'Shape update from iframe A did not propagate to iframe B within 500ms',
        }).toBe(updatedName);

        // Verify propagation to host within 500ms
        await expect.poll(async () => {
            return await page.evaluate(() => window.__cadStore?.doc.data.shapes?.['rect-1']?.name);
        }, {
            timeout: 500,
            intervals: [20, 50, 100],
            message: 'Shape update from iframe A did not propagate to host within 500ms',
        }).toBe(updatedName);
    });
});
