'use strict';

// Mock resumeQA to avoid network calls in unit tests
jest.mock('../utils/resumeQA', () => ({
    getAIAnswer: jest.fn().mockResolvedValue(null)
}));

const { getAnswer, normalizeText, getBestFuzzyMatch } = require('../utils/questionAnswerer');

const sampleUser = {
    experience: '3',
    react: '2',
    salary: '800000',
    'notice period': '30',
    github: 'https://github.com/testuser',
    linkedin: 'https://linkedin.com/in/testuser',
    gender: 'Male',
    english: 'Fluent',
    education: 'Bachelor of Engineering'
};

describe('normalizeText', () => {
    test('lowercases and strips punctuation', () => {
        expect(normalizeText('Hello, World!')).toBe('hello world');
    });

    test('collapses whitespace', () => {
        expect(normalizeText('  two   spaces  ')).toBe('two spaces');
    });

    test('returns empty string for null/undefined', () => {
        expect(normalizeText(null)).toBe('');
        expect(normalizeText(undefined)).toBe('');
    });
});

describe('getAnswer — rule-based', () => {
    test('returns react experience for React question', async () => {
        const answer = await getAnswer('How many years of experience do you have in React?', sampleUser);
        expect(answer).toBe('2');
    });

    test('returns general experience for generic experience question', async () => {
        const answer = await getAnswer('How many years of total experience do you have?', sampleUser);
        expect(answer).toBe('3');
    });

    test('returns Yes for work authorization question', async () => {
        const answer = await getAnswer('Are you legally authorized to work in India?', sampleUser);
        expect(answer).toBe('Yes');
    });

    test('returns salary for CTC question', async () => {
        const answer = await getAnswer('What is your expected CTC?', sampleUser);
        expect(answer).toBe('800000');
    });

    test('returns notice period', async () => {
        const answer = await getAnswer('What is your notice period?', sampleUser);
        expect(answer).toBe('30');
    });

    test('returns GitHub URL for github question', async () => {
        const answer = await getAnswer('What is your GitHub profile URL?', sampleUser);
        expect(answer).toBe('https://github.com/testuser');
    });

    test('returns Yes for I certify consent question', async () => {
        const answer = await getAnswer('I certify that all of the above is true.', sampleUser);
        expect(answer).toBe('Yes');
    });

    test('returns No for sponsorship question with no user data', async () => {
        const answer = await getAnswer('Do you require visa sponsorship?', {});
        expect(answer).toBe('No');
    });

    test('returns Yes for remote work question', async () => {
        const answer = await getAnswer('Are you open to remote work?', sampleUser);
        expect(answer).toBe('Yes');
    });

    test('returns gender from user data', async () => {
        const answer = await getAnswer('What is your gender?', sampleUser);
        expect(answer).toBe('Male');
    });
});

describe('getBestFuzzyMatch', () => {
    test('finds close match above threshold', () => {
        const result = getBestFuzzyMatch('github profile', { github: 'https://github.com/x' });
        expect(result).toBe('https://github.com/x');
    });

    test('returns null for no close match', () => {
        const result = getBestFuzzyMatch('zzz unrelated zzz xyz', { github: 'val' });
        expect(result).toBeNull();
    });

    test('returns null for empty userData', () => {
        const result = getBestFuzzyMatch('anything', {});
        expect(result).toBeNull();
    });
});
