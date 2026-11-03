// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { defaultPageConfig, isPageLink, parsePageConfig, readPageConfig } from './pageConfig'

function pageWith(block: string | null): Document {
  const doc = document.implementation.createHTMLDocument('test')
  if (block !== null) {
    const script = doc.createElement('script')
    script.type = 'application/json'
    script.id = 'page-config'
    script.textContent = block
    doc.body.append(script)
  }
  return doc
}

describe('readPageConfig', () => {
  it('reads the settings the server wrote', () => {
    const config = readPageConfig(
      pageWith(
        JSON.stringify({
          header: 'Pralvo status',
          maximumNumberOfResults: '50',
          defaultSortBy: 'health',
          footerLinks: [{ name: 'Pralvo', link: 'https://pralvo.com/' }],
          sourceLink: 'https://github.com/Pralvo/gatus',
        }),
      ),
    )
    expect(config.header).toBe('Pralvo status')
    expect(config.maximumNumberOfResults).toBe(50)
    expect(config.defaultSortBy).toBe('health')
    expect(config.footerLinks).toEqual([{ name: 'Pralvo', link: 'https://pralvo.com/' }])
    expect(config.sourceLink).toBe('https://github.com/Pralvo/gatus')
  })

  it('falls back to the defaults when the block is missing, empty or not JSON', () => {
    expect(readPageConfig(pageWith(null))).toEqual(defaultPageConfig)
    expect(readPageConfig(pageWith('  '))).toEqual(defaultPageConfig)
    expect(readPageConfig(pageWith('{{ .Config }}'))).toEqual(defaultPageConfig)
  })
})

describe('parsePageConfig', () => {
  it('drops links that could run script or have no name', () => {
    const config = parsePageConfig({
      link: 'javascript:alert(1)',
      sourceLink: 'javascript:alert(1)',
      footerLinks: [
        { name: 'Bad', link: 'javascript:alert(1)' },
        { name: '', link: 'https://pralvo.com/' },
        { name: 'Reports', link: '/reports' },
        'not a link',
      ],
    })
    expect(config.link).toBe('')
    expect(config.sourceLink).toBe(defaultPageConfig.sourceLink)
    expect(config.footerLinks).toEqual([{ name: 'Reports', link: '/reports' }])
  })

  it('refuses values outside the allowed sets', () => {
    const config = parsePageConfig({
      defaultSortBy: 'random',
      defaultFilterBy: 7,
      maximumNumberOfResults: -3,
      header: 42,
    })
    expect(config.defaultSortBy).toBe('name')
    expect(config.defaultFilterBy).toBe('none')
    expect(config.maximumNumberOfResults).toBe(100)
    expect(config.header).toBe('Gatus')
  })

  it('treats anything but an object as empty', () => {
    expect(parsePageConfig(null)).toEqual(defaultPageConfig)
    expect(parsePageConfig('text')).toEqual(defaultPageConfig)
  })
})

describe('isPageLink', () => {
  it.each([
    ['https://pralvo.com/', true],
    ['http://example.org', true],
    ['/reports', true],
    ['javascript:alert(1)', false],
    ['pralvo.com', false],
    ['', false],
  ])('%s gives %s', (link, expected) => {
    expect(isPageLink(link)).toBe(expected)
  })
})
