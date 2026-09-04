// tests/unit/joinToken.util.test.js
const jwt = require('jsonwebtoken');
const {
  signJoinToken,
  verifyJoinToken,
  JOIN_TOKEN_TTL_SECONDS,
} = require('../../src/utils/joinToken.util');
const env = require('../../src/config/env');

describe('signJoinToken / verifyJoinToken', () => {
  it('يوقّع ويتحقق رمزاً صحيحاً يتضمن courseId عند تمريره', () => {
    const token = signJoinToken({
      studentId: '507f1f77bcf86cd799439011',
      sessionId: 'sess1',
      courseId: 'course1',
    });
    const payload = verifyJoinToken(token);

    expect(payload.studentId).toBe('507f1f77bcf86cd799439011');
    expect(payload.sessionId).toBe('sess1');
    expect(payload.courseId).toBe('course1');
    expect(payload.type).toBe('live_join');
  });

  it('لا يتضمن حقل courseId عند عدم تمريره (فرع if(courseId) السالب)', () => {
    const token = signJoinToken({ studentId: 's1', sessionId: 'sess1' });
    const payload = verifyJoinToken(token);
    expect(payload.courseId).toBeUndefined();
  });

  it('TTL الرمز يطابق JOIN_TOKEN_TTL_SECONDS المُصدَّرة (5 دقائق)', () => {
    expect(JOIN_TOKEN_TTL_SECONDS).toBe(5 * 60);
  });

  it('يرمي AppError عند رمز منتهي الصلاحية', () => {
    const expiredToken = jwt.sign(
      { studentId: 's1', sessionId: 'sess1', type: 'live_join' },
      env.jwt.accessSecret,
      { algorithm: 'HS256', expiresIn: -1 }
    );
    expect(() => verifyJoinToken(expiredToken)).toThrow(/رمز الانضمام غير صالح أو منتهي الصلاحية/);
  });

  it('يرمي AppError عند توقيع الرمز بمفتاح خاطئ', () => {
    const wrongKeyToken = jwt.sign(
      { studentId: 's1', sessionId: 'sess1', type: 'live_join' },
      'completely-wrong-secret',
      { algorithm: 'HS256', expiresIn: '5m' }
    );
    expect(() => verifyJoinToken(wrongKeyToken)).toThrow(/رمز الانضمام غير صالح/);
  });

  it('يرفض type غير مطابق (INVALID_TOKEN_TYPE) — يغطي فرع payload.type !== "live_join"', () => {
    const wrongTypeToken = jwt.sign(
      { studentId: 's1', sessionId: 'sess1', type: 'access' },
      env.jwt.accessSecret,
      { algorithm: 'HS256', expiresIn: '5m' }
    );
    expect(() => verifyJoinToken(wrongTypeToken)).toThrow(/نوع رمز الانضمام غير صحيح/);
  });

  it('يرفض رمزاً بخوارزمية غير HS256 (منع alg confusion) — يغطي فرع catch العام', () => {
    // alg:none غير مسموح به من jsonwebtoken نفسها عند verify بقائمة صريحة،
    // لذا نستخدم خوارزمية مختلفة مدعومة (HS384) لإثبات رفض أي alg خارج القائمة البيضاء
    const differentAlgToken = jwt.sign(
      { studentId: 's1', sessionId: 'sess1', type: 'live_join' },
      env.jwt.accessSecret,
      { algorithm: 'HS384', expiresIn: '5m' }
    );
    expect(() => verifyJoinToken(differentAlgToken)).toThrow(/رمز الانضمام غير صالح/);
  });
});
