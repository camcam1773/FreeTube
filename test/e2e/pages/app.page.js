import { expect } from '../fixtures.js'
import { VIDEO_ONE } from '../fixtures/entities.js'

/** Thin page object for actions shared by multiple user journeys. */
export class AppPage {
  constructor(window) {
    this.window = window
  }

  async search(query) {
    const searchBox = this.window.getByTestId('search-bar').locator('input')
    await searchBox.fill(query)
    await searchBox.press('Enter')
  }

  async openFirstVideo() {
    await this.search('freetube e2e')
    await this.window.getByText(VIDEO_ONE.title).first().click()
    await expect(this.window.locator('.videoArea h1')).toContainText(VIDEO_ONE.title)
  }

  async navigateTo(path) {
    await this.window.locator(`.sideNav a[href="#${path}"]:visible`).first().click()
    await expect(this.window).toHaveURL(new RegExp(`#${path}`))
  }
}
