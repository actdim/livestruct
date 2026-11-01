import { test, expect } from '@playwright/test';

test.describe('LiveStruct Ephemeral Overlay Sync', () => {
    test('60 patches in A without flush shows tentative in B, then committed on flush', async ({ page }) => {
        await page.goto('/?split=dual');

        // Wait for host shell and child frames
        await page.waitForFunction(() => typeof window !== 'undefined' && Boolean(window.__cadStore));
        await expect(page.locator('[data-testid="dual-split-container"]')).toBeVisible();

        const frameA = page.frame({ url: /viewport=A/ });
        const frameB = page.frame({ url: /viewport=B/ });
        expect(frameA).toBeTruthy();
        expect(frameB).toBeTruthy();

        await frameA!.waitForFunction(() => typeof window !== 'undefined' && Boolean(window.__cadStore));
        await frameB!.waitForFunction(() => typeof window !== 'undefined' && Boolean(window.__cadStore));

        // Apply 60 rapid patches in iframe A without flushing
        await frameA!.evaluate(() => {
            const doc = window.__cadStore!.doc;
            for (let i = 1; i <= 60; i++) {
                void doc.patch({
                    shapes: {
                        'rect-1': {
                            x: 100 + i,
                            name: 'Tentative Step ' + i,
                        },
                    },
                });
            }
        });

        // Frame B should observe the tentative value with isTentative = true
        await expect.poll(async () => {
            return await frameB!.evaluate(() => ({
                isTentative: window.__cadStore?.doc.isTentative,
                name: window.__cadStore?.doc.data.shapes?.['rect-1']?.name,
                x: window.__cadStore?.doc.data.shapes?.['rect-1']?.x,
            }));
        }, {
            timeout: 2000,
            intervals: [20, 50, 100],
            message: 'iframe B did not observe tentative overlay state from iframe A',
        }).toEqual({
            isTentative: true,
            name: 'Tentative Step 60',
            x: 160,
        });

        // Flush in iframe A to commit changes
        await frameA!.evaluate(async () => {
            await window.__cadStore!.doc.flush();
        });

        // Frame B should now have committed state with isTentative = false
        await expect.poll(async () => {
            return await frameB!.evaluate(() => ({
                isTentative: window.__cadStore?.doc.isTentative,
                name: window.__cadStore?.doc.data.shapes?.['rect-1']?.name,
                x: window.__cadStore?.doc.data.shapes?.['rect-1']?.x,
            }));
        }, {
            timeout: 2000,
            intervals: [20, 50, 100],
            message: 'iframe B did not transition from tentative to committed state',
        }).toEqual({
            isTentative: false,
            name: 'Tentative Step 60',
            x: 160,
        });
    });
});
