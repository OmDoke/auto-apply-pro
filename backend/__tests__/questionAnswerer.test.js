'use strict';

// Mock resumeQA to avoid network calls in unit tests
jest.mock('../utils/resumeQA', () => ({
    getAIAnswer: jest.fn().mockResolvedValue(null)
}));

const { getAnswer, normalizeText, getBestFuzzyMatch } = require('../utils/questionAnswerer');
const { getAIAnswer } = require('../utils/resumeQA');

beforeEach(() => {
    getAIAnswer.mockReset();
    getAIAnswer.mockResolvedValue(null);
    process.env.LLM_FIRST = 'false';
});

const sampleUser = {
    'first name': 'Onkar',
    'last name': 'Doke',
    'full name': 'Onkar Doke',
    experience: '3',
    react: '2',
    frontend: '2',
    backend: '2',
    'full stack': '2',
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
        expect(answer).toBe('6');
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

    test('does not match c experience to contact phone number', async () => {
        const answer = await getAnswer('How many years of experience do you have in C#?', sampleUser);
        // Should fall back to general experience (3) rather than matching 'contact' (+91-7745042879)
        expect(answer).toBe('3');
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

describe('getAnswer — precedence logic and options', () => {
    test('Smart Hybrid routes dynamic notice period question to LLM first', async () => {
        getAIAnswer.mockResolvedValueOnce('45');
        const answer = await getAnswer('What is your notice period?', sampleUser);
        expect(getAIAnswer).toHaveBeenCalledWith('What is your notice period?', {}, sampleUser);
        expect(answer).toBe('45');
    });

    test('Smart Hybrid routes gender question to static rules first', async () => {
        getAIAnswer.mockResolvedValueOnce('Female');
        const answer = await getAnswer('What is your gender?', sampleUser);
        expect(answer).toBe('Male');
        expect(getAIAnswer).not.toHaveBeenCalled();
    });

    test('LLM_FIRST=true routes gender question to LLM first', async () => {
        process.env.LLM_FIRST = 'true';
        getAIAnswer.mockResolvedValueOnce('Female');
        const answer = await getAnswer('What is your gender?', sampleUser);
        expect(answer).toBe('Female');
        expect(getAIAnswer).toHaveBeenCalled();
    });
});

describe('getAnswer — new bug fixes and edge cases', () => {
    test('converts experience years to months when question asks for months', async () => {
        const answer = await getAnswer('how many months of experience do you have as a Frontend Intern', sampleUser);
        // sampleUser has react: '2' (which is the frontend skill matched). 2 years * 12 = 24 months
        expect(answer).toBe('24');
    });

    test('returns Yes for salary cap or stipend Yes/No questions', async () => {
        const answer1 = await getAnswer(
            'Do you agree with the Upper salary Cap of 35K/Month for experienced & 25k/Month for Freshers ?', 
            sampleUser,
            { options: ['Yes', 'No'] }
        );
        expect(answer1).toBe('Yes');

        const answer2 = await getAnswer(
            'The Stipend will be upto 5k based on interview performance only apply if you are comfortable with it otherwise don\'t apply', 
            sampleUser,
            { options: ['Yes', 'No'] }
        );
        expect(answer2).toBe('Yes');
    });

    test('discards invalid fuzzy matches for Yes/No fields and falls back to Yes', async () => {
        const answer = await getAnswer(
            'only apply you have completed your education otherwise don\'t apply', 
            sampleUser,
            { options: ['Yes', 'No'] }
        );
        // 'Bachelor of Engineering' is in sampleUser.education, but it's not in ['Yes', 'No']
        // So it should be discarded, and fall back to 'Yes'
        expect(answer).toBe('Yes');
    });

    test('returns first name for preferred name and does not match referral rule', async () => {
        const answer = await getAnswer('Preferred name', sampleUser);
        expect(answer).toBe('onkar');
    });

    test('returns No for serving notice questions', async () => {
        const answer = await getAnswer('Are you currently serving notice?', sampleUser, { type: 'radio', options: ['Yes', 'No'] });
        expect(answer).toBe('No');
    });

    test('scales salary value to raw INR when question asks for INR', async () => {
        const answer = await getAnswer('Please enter your current ctc in INR', sampleUser);
        // sampleUser.salary is '800000', but if we look at ruleBasedMatch, it uses current salary (2 in loaded profile or 200000 when scaled)
        // Wait, sampleUser does not have current salary, so it uses '2' default or '800000' if it gets it.
        // Let's test with a custom user object having 'current salary': '2.5'
        const customUser = { 'current salary': '2.5', 'expected salary': '6' };
        const ansCurrent = await getAnswer('Please enter your current ctc in INR', customUser);
        expect(ansCurrent).toBe('250000');

        const ansExpected = await getAnswer('Please enter your expected ctc in INR', customUser);
        expect(ansExpected).toBe('600000');
    });

    test('returns products built with AI tools count', async () => {
        const answer = await getAnswer('How many products built with AI tools?', sampleUser);
        expect(answer).toBe('5');
    });

    test('returns Available upon request for employment references', async () => {
        const answer = await getAnswer('Please add 1 or 2 employment references and their relationship', sampleUser);
        expect(answer).toBe('Available upon request');
    });

    test('returns job that shows relevant experience default fallback', async () => {
        const answer = await getAnswer('Enter a job that shows relevant experience', sampleUser);
        expect(answer).toBe('ht labs and role intern');
    });

    test('returns custom job that shows relevant experience when defined in user profile', async () => {
        const customUser = {
            ...sampleUser,
            'relevant experience job': 'Acme Corp and Senior Engineer'
        };
        const answer = await getAnswer('Enter a job that shows relevant experience', customUser);
        expect(answer).toBe('Acme Corp and Senior Engineer');
    });

    test('returns company name static match and fallback', async () => {
        const answerDefault = await getAnswer('company', sampleUser);
        expect(answerDefault).toBe('ht labs');

        const customUser = { ...sampleUser, company: 'Google' };
        const answerCustom = await getAnswer('Please list your most recent company name', customUser);
        expect(answerCustom).toBe('Google');
    });

    test('returns job title static match and fallback', async () => {
        const answerDefault = await getAnswer('job title', sampleUser);
        expect(answerDefault).toBe('intern');

        const customUser = { ...sampleUser, 'job title': 'Software Developer' };
        const answerCustom = await getAnswer('What is your current job title?', customUser);
        expect(answerCustom).toBe('Software Developer');
    });

    test('does not match job title for prefix salutations', async () => {
        const answer = await getAnswer('title', sampleUser, { options: ['Mr.', 'Ms.', 'Dr.'] });
        // should return null or fall through to default fallback/AI, rather than returning 'intern'
        expect(answer).not.toBe('intern');
    });

    describe('LinkedIn source overrides', () => {
        test('converts notice period days to weeks when source is linkedin', async () => {
            const answer = await getAnswer('What is your notice period in weeks?', { ...sampleUser, 'notice period': '15 days' }, { source: 'linkedin' });
            expect(answer).toBe('2');
        });

        test('does not convert notice period days to weeks when source is not linkedin', async () => {
            const answer = await getAnswer('What is your notice period in weeks?', sampleUser);
            expect(answer).toBe('30');
        });

        test('defaults additional months of experience to 0 when source is linkedin', async () => {
            const answer = await getAnswer('Please select your total additional months of experience:', sampleUser, { source: 'linkedin' });
            expect(answer).toBe('0');
        });

        test('returns No for relatives employed check when source is linkedin', async () => {
            const answer = await getAnswer('Do you have any relatives employed by this organization?', sampleUser, { source: 'linkedin' });
            expect(answer).toBe('No');
        });

        test('returns No for ever been employed check when source is linkedin', async () => {
            const answer = await getAnswer('Have you ever been employed at Precisely?', sampleUser, { source: 'linkedin' });
            expect(answer).toBe('No');
        });
    });
});
