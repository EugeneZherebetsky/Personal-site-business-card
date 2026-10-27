import { describe, expect, it } from 'vitest'
import { canonicalSource, companyKey, companySuggestions, sameCompany, sourceGroup, sourceSuggestions } from './naming'

describe('source names', () => {
  it('tidies whole-value spelling variants on save and keeps anything else as typed', () => {
    expect(canonicalSource(' linkedin ')).toBe('LinkedIn')
    expect(canonicalSource('referal')).toBe('Referral')
    expect(canonicalSource('company site')).toBe('Company site')
    expect(canonicalSource('J&J')).toBe('J&J')
    expect(canonicalSource('referral (Daniil)')).toBe('referral (Daniil)')
    expect(canonicalSource('Remotive')).toBe('Remotive')
    expect(canonicalSource(null)).toBe('')
  })

  it('groups detailed entries under their channel for analytics', () => {
    expect(sourceGroup('referral (Daniil)')).toBe('Referral')
    expect(sourceGroup('Jack & Jill link to BorgWarner Workday')).toBe('Jack & Jill')
    expect(sourceGroup('J&J')).toBe('J&J')
    expect(sourceGroup('LinkedIn Easy Apply')).toBe('LinkedIn')
    expect(sourceGroup('company website')).toBe('Company site')
    expect(sourceGroup('Arbeitnow')).toBe('Arbeitnow')
    expect(sourceGroup('  ')).toBe('')
  })

  it('suggests the standard list plus the user\'s own labels once each', () => {
    const suggestions = sourceSuggestions(['linkedin', 'Arbeitnow', 'arbeitnow', null])
    expect(suggestions.filter((value) => value === 'LinkedIn')).toHaveLength(1)
    expect(suggestions).toContain('Arbeitnow')
    expect(suggestions.filter((value) => value.toLowerCase() === 'arbeitnow')).toHaveLength(1)
  })
})

describe('company names', () => {
  it('ignores case, punctuation, brackets and legal suffixes', () => {
    expect(companyKey('Siemens Energy Kft.')).toBe('siemens energy')
    expect(companyKey('Red Bull IT Services GmbH')).toBe('red bull it services')
    expect(companyKey('Deloitte (Deloitte Technology, Corporate Functions)')).toBe('deloitte')
    expect(companyKey('MOL Group')).toBe('mol')
    expect(companyKey('Group')).toBe('group')
  })

  it('treats a name and its longer form as the same employer', () => {
    expect(sameCompany('GRAPHISOFT', 'Graphisoft')).toBe(true)
    expect(sameCompany('MOL', 'MOL Group')).toBe(true)
    expect(sameCompany('Deloitte Hungary', 'Deloitte')).toBe(true)
    expect(sameCompany('Red Bull', 'Red Bull IT Services GmbH')).toBe(true)
    expect(sameCompany('Roche', 'Rochester Institute')).toBe(false)
    expect(sameCompany('', 'Acme')).toBe(false)
  })

  it('offers one suggestion per employer using the most common spelling', () => {
    expect(companySuggestions(['Graphisoft', 'GRAPHISOFT', 'Graphisoft', 'Cytiva', null])).toEqual(['Cytiva', 'Graphisoft'])
  })
})
