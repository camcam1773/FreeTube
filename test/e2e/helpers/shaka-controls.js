const resolutionOf = (label) => Number(label.match(/(\d+)p/)?.[1] ?? 0)

/** Reopen the Shaka resolution menu; Shaka rebuilds its controls on live reloads. */
export async function openResolutionMenu(window) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const moreSettings = window.getByRole('button', { name: 'More settings' })
    if (await moreSettings.isVisible().catch(() => false)) {
      await moreSettings.click({ timeout: 5_000 }).catch(() => {})
    }

    const button = window.locator('.shaka-resolution-button:visible').first()
    if (await button.count()) {
      const status = await button.getAttribute('shaka-status')
      const currentResolution = resolutionOf(status ?? (await button.innerText()))
      try {
        await button.click({ timeout: 5_000 })
        const options = window.locator('.shaka-resolutions .explicit-resolution:visible')
        if (await options.count()) {
          return { options, currentResolution, currentIsAuto: /auto/i.test(status ?? '') }
        }
      } catch {
        // The controls were rebuilt between locating and clicking.
      }
    }

    await window.waitForTimeout(500)
  }

  throw new Error('Could not open Shaka resolution menu')
}

export { resolutionOf }
