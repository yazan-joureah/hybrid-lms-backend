// tests/unit/ai/systemPrompt.service.test.js
const {
  buildInstructorSystemPrompt,
  buildStudentSystemPrompt,
  FIXED_INSTRUCTOR_INSTRUCTION,
  FIXED_STUDENT_INSTRUCTION,
} = require('../../../src/services/ai/systemPrompt.service');

describe('buildInstructorSystemPrompt', () => {
  it('يتضمن التعليمات الثابتة وعنوان الكورس والوحدات والإحصاءات', () => {
    const { systemPrompt } = buildInstructorSystemPrompt({
      courseTitle: 'أمن المعلومات',
      unitTitles: ['المقدمة', 'التشفير'],
      aggregatedPerformance: { activeEnrollmentCount: 12, avgAttendanceMinutes: 45 },
    });

    expect(systemPrompt).toContain(FIXED_INSTRUCTOR_INSTRUCTION);
    expect(systemPrompt).toContain('أمن المعلومات');
    expect(systemPrompt).toContain('المقدمة، التشفير');
    expect(systemPrompt).toContain('12');
    expect(systemPrompt).toContain('45');
  });

  it('يُظهر "لا توجد وحدات بعد" عند مصفوفة وحدات فارغة', () => {
    const { systemPrompt } = buildInstructorSystemPrompt({
      courseTitle: 'كورس جديد',
      unitTitles: [],
    });
    expect(systemPrompt).toContain('لا توجد وحدات بعد');
  });

  it('يُظهر "غير متاح" عند غياب بيانات الأداء المُجمَّعة', () => {
    const { systemPrompt } = buildInstructorSystemPrompt({ courseTitle: 'كورس', unitTitles: [] });
    expect(systemPrompt).toContain('غير متاح');
  });

  it('يُقفَل الناتج (Object.freeze) لمنع التعديل من أي طبقة لاحقة', () => {
    const result = buildInstructorSystemPrompt({ courseTitle: 'كورس', unitTitles: [] });
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('buildStudentSystemPrompt', () => {
  it('يتضمن التعليمات الثابتة والوحدات المتاحة والمُكمَلة فقط', () => {
    const { systemPrompt } = buildStudentSystemPrompt({
      courseTitle: 'شبكات',
      unitTitles: ['وحدة 1', 'وحدة 2', 'وحدة 3'],
      completedUnitTitles: ['وحدة 1'],
    });

    expect(systemPrompt).toContain(FIXED_STUDENT_INSTRUCTION);
    expect(systemPrompt).toContain('وحدة 1، وحدة 2، وحدة 3');
    expect(systemPrompt).toMatch(/الوحدات التي أتمّها هذا الطالب: وحدة 1(?!،)/);
  });

  it('يُظهر "لم يُكمل أي وحدة بعد" عند عدم إكمال أي وحدة', () => {
    const { systemPrompt } = buildStudentSystemPrompt({
      courseTitle: 'كورس',
      unitTitles: ['وحدة 1'],
      completedUnitTitles: [],
    });
    expect(systemPrompt).toContain('لم يُكمل أي وحدة بعد');
  });

  it('يُقفَل الناتج (Object.freeze)', () => {
    const result = buildStudentSystemPrompt({ courseTitle: 'كورس' });
    expect(Object.isFrozen(result)).toBe(true);
  });
});
