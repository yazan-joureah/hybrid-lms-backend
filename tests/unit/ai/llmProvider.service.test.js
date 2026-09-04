// tests/unit/ai/llmProvider.service.test.js
//
// AI_PROVIDER يُقرأ مرة واحدة عند تحميل الموديول (`const AI_PROVIDER =
// env.ai.provider`) — كل اختبار يغيّر القيمة يحتاج jest.resetModules()
// وإعادة require كاملة، وإلا ستبقى القيمة الأولى محفوظة عبر كل الاختبارات.
//
// المشروع يدعم فعلياً 3 مزوّدين فقط في الـ switch: stub, tinyllama,
// ollama. لا يوجد case لـ deepseek/groq رغم وجود ملفات providers/
// ميتة على القرص لهما — غير مُختبَرة هنا عمداً لأنها غير مُستخدَمة.

const ORIGINAL_AI_PROVIDER = process.env.AI_PROVIDER;

afterAll(() => {
  if (ORIGINAL_AI_PROVIDER === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = ORIGINAL_AI_PROVIDER;
});

describe('llmProvider.service — stub provider (الافتراضي)', () => {
  let llmProvider;

  beforeEach(() => {
    jest.resetModules();
    process.env.AI_PROVIDER = 'stub';
    // eslint-disable-next-line global-require
    llmProvider = require('../../../src/services/ai/llmProvider.service');
  });

  it('mode=student_query: يتضمن جزءاً من رسالة المستخدم في الرد', async () => {
    const result = await llmProvider.generateCompletion({
      systemPrompt: 'سياق',
      userMessage: 'ما هو التكامل؟',
      context: { mode: 'student_query' },
    });
    expect(result.provider).toBe('stub');
    expect(result.text).toContain('ما هو التكامل؟');
  });

  it('mode=instructor_suggestions: يُرجع القالب المخصَّص', async () => {
    const result = await llmProvider.generateCompletion({
      systemPrompt: 'سياق',
      userMessage: 'حسّن الوحدة 2',
      context: { mode: 'instructor_suggestions' },
    });
    expect(result.text).toContain('مقترح عام');
  });

  it('mode=instructor_performance_summary: يُرجع القالب المخصَّص', async () => {
    const result = await llmProvider.generateCompletion({
      systemPrompt: 'سياق',
      userMessage: 'ملخص',
      context: { mode: 'instructor_performance_summary' },
    });
    expect(result.text).toContain('ملخص عام');
  });

  it('يسقط على قالب general عند mode غير معروف أو غياب context بالكامل', async () => {
    const unknownMode = await llmProvider.generateCompletion({
      systemPrompt: 'سياق',
      userMessage: 'رسالة',
      context: { mode: 'xyz' },
    });
    const noContext = await llmProvider.generateCompletion({
      systemPrompt: 'سياق',
      userMessage: 'رسالة',
    });
    expect(unknownMode.text).toContain('طبقة الأمان الكاملة');
    expect(noContext.text).toContain('طبقة الأمان الكاملة');
  });

  it('يقتصّ userMessage الطويل عند 200 حرف في قالب student_query (truncate)', async () => {
    const longMessage = 'س'.repeat(300);
    const result = await llmProvider.generateCompletion({
      systemPrompt: 'سياق',
      userMessage: longMessage,
      context: { mode: 'student_query' },
    });
    expect(result.text).toContain('…');
  });
});

describe('llmProvider.service — تحويل الاستدعاء (dispatch) للمزوّدين الخارجيين', () => {
  it('يستدعي tinyllama.provider.generateCompletion عندما AI_PROVIDER=tinyllama', async () => {
    jest.resetModules();
    process.env.AI_PROVIDER = 'tinyllama';
    const mockGenerate = jest
      .fn()
      .mockResolvedValue({ text: 'رد tinyllama', provider: 'tinyllama' });
    jest.doMock('../../../src/services/ai/providers/tinyllama.provider', () => ({
      generateCompletion: mockGenerate,
    }));

    // eslint-disable-next-line global-require
    const llmProvider = require('../../../src/services/ai/llmProvider.service');
    const result = await llmProvider.generateCompletion({
      systemPrompt: 'sp',
      userMessage: 'msg',
      context: { mode: 'student_query' },
    });

    expect(mockGenerate).toHaveBeenCalledWith({
      systemPrompt: 'sp',
      userMessage: 'msg',
      context: { mode: 'student_query' },
    });
    expect(result.text).toBe('رد tinyllama');
    jest.dontMock('../../../src/services/ai/providers/tinyllama.provider');
  });

  // ⚠️ راجع الملاحظة الأمنية أعلى الملف: ollama.provider.js غير موجود
  // فعلياً بحسب تقرير التغطية — هذا الاختبار يستخدم virtual:true ليعمل
  // بمعزل عن ذلك، وهو تحقّق منطقي فقط لسلوك الـ switch، وليس إثباتاً
  // لوجود الملف الحقيقي في بيئة الإنتاج.
  it('[يتطلب تحققاً يدوياً] يستدعي ollama.provider.generateCompletion عندما AI_PROVIDER=ollama', async () => {
    jest.resetModules();
    process.env.AI_PROVIDER = 'ollama';
    const mockGenerate = jest.fn().mockResolvedValue({ text: 'رد ollama', provider: 'ollama' });
    jest.doMock(
      '../../../src/services/ai/providers/ollama.provider',
      () => ({ generateCompletion: mockGenerate }),
      { virtual: true }
    );

    // eslint-disable-next-line global-require
    const llmProvider = require('../../../src/services/ai/llmProvider.service');
    const result = await llmProvider.generateCompletion({ systemPrompt: 'sp', userMessage: 'msg' });

    expect(mockGenerate).toHaveBeenCalled();
    expect(result.text).toBe('رد ollama');
    jest.dontMock('../../../src/services/ai/providers/ollama.provider');
  });
});

describe('llmProvider.service — مزوّد غير معروف', () => {
  it('يرمي خطأ صريحاً يذكر اسم المزوّد عند AI_PROVIDER غير مدعوم', async () => {
    jest.resetModules();
    process.env.AI_PROVIDER = 'some-unsupported-provider';
    // eslint-disable-next-line global-require
    const llmProvider = require('../../../src/services/ai/llmProvider.service');

    await expect(
      llmProvider.generateCompletion({ systemPrompt: 'sp', userMessage: 'msg' })
    ).rejects.toThrow(/Unknown AI_PROVIDER "some-unsupported-provider"/);
  });
});
