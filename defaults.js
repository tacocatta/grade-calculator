/*
 * Default assessments: everyone using the site gets these, with the score left
 * blank for them to fill in.
 *
 * HOW TO ADD ONE
 *   1. Add a line to the right course below, for example:
 *        { name: 'Unit 4 Test', type: 'test', outOf: 30 },
 *   2. Commit and push. Everyone gets it the next time they open the site,
 *      added to the end of their list. People who already have it don't get a copy.
 *      Defaults can't be deleted or renamed on the site, and their type and
 *      out of are fixed, so everyone has the same list (people can still untick
 *      one so it doesn't count, and give it their own weight).
 *
 * FIXING A MISTAKE: change the type or outOf here and push. Everyone's copy
 * updates the next time they open the site; their scores stay.
 *
 * FIELDS
 *   name    What it's called. Must be unique within the course.
 *   type    'test' or 'quiz' in every course
 *           'lab'   AP Physics only
 *           'group' Group Assignment (Advanced Functions and Data Management only)
 *   outOf   What it's marked out of.
 *           AP Physics: one per category, e.g. outOf: { K: 10, T: 20, C: 5, A: 10 }
 *           (leave out a category the assessment doesn't test).
 *   weight  Optional. Gives this one assessment its own weight instead of its type's.
 *
 * DON'T rename or remove an entry once it's pushed. The name is how the site
 * knows who already has it, so a renamed entry shows up again as a new one,
 * and a removed one becomes an ordinary (deletable) assessment for people who have it.
 *
 * Data Management CPT marks go in `cpt` the same way: { name: 'Proposal', outOf: 20 }
 */
window.COURSE_DEFAULTS = {
  physics: {
    assessments: [
      { name: 'Unit 1 Quiz', type: 'quiz', outOf: { K: 15, T: 15 } },
      { name: 'Unit 1 Test', type: 'test', outOf: { K: 20, T: 20, C: 10, A: 10 } },
      { name: 'Unit 1 Lab', type: 'lab', outOf: { K: 5, T: 5, C: 5, A: 5 } },
    ]
  },

  calculus: {
    assessments: [
      { name: 'Chapter 1 Precalculus Assignment', type: 'quiz', outOf: 20 },
      { name: 'Chapter 2 Test', type: 'test', outOf: 38 },
      { name: 'Chapter 3 Quiz', type: 'quiz', outOf: 21 },
      { name: 'Chapter 3 Test', type: 'test', outOf: 40 },
      { name: 'Chapter 4 Test', type: 'test', outOf: 37 },
      { name: 'Chapter 5 Quiz', type: 'quiz', outOf: 20 },
    ]
  },

  advfunctions: {
    assessments: [
      { name: 'Unit 1 Quiz', type: 'quiz', outOf: 18 },
      { name: 'Unit 1 Test', type: 'test', outOf: 34 },
      { name: 'Unit 2 Quiz', type: 'quiz', outOf: 20 },
      { name: 'Unit 2 Test', type: 'test', outOf: 30 },
      { name: 'Unit 3 Quiz', type: 'quiz', outOf: 31 },
      { name: 'Unit 3 Test', type: 'test', outOf: 33 },
      { name: 'Unit 1-3 GC', type: 'quiz', outOf: 20 },
      { name: 'Unit 4 Quiz', type: 'quiz', outOf: 19 },
    ]
  },

  datamgmt: {
    assessments: [
      { name: 'Unit 1 Test', type: 'test', outOf: 33 },
      { name: 'Unit 2 Quiz', type: 'quiz', outOf: 18 },
      { name: 'Password Probability', type: 'group', outOf: 25 },
      { name: 'Unit 2 Test', type: 'test', outOf: 30 },
      { name: 'Unit 3 Quiz', type: 'quiz', outOf: 17 },
      { name: 'Unit 3 Test', type: 'test', outOf: 30 },
    ],
    cpt: [
    ]
  }
};
