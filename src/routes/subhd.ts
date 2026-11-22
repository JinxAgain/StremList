import { Request, Response } from 'express';
import { SubhdProvider } from '../services/subtitles/providers/subhd.js';
import { subhdSession } from '../services/subtitles/providers/subhd-session.js';

const provider = new SubhdProvider();

export async function handleSubhdWechatCode(_req: Request, res: Response) {
  try {
    const result = await provider.requestWechatCode();
    return res.json({
      success: true,
      code: result.code,
      expiresAt: result.expiresAt,
      qrUrl: result.qrUrl,
      account: '火星研究社'
    });
  } catch (err: any) {
    return res.status(502).json({
      success: false,
      error: err?.message || 'Failed to request WeChat verification code'
    });
  }
}

export async function handleSubhdWechatStatus(_req: Request, res: Response) {
  try {
    const status = await provider.checkWechatStatus();
    const session = subhdSession.load();
    return res.json({
      verified: status.verified,
      verifiedAt: session?.verifiedAt,
      expiresAt: session?.expiresAt,
      block: SubhdProvider.getBlockState()
    });
  } catch (err: any) {
    const session = subhdSession.load();
    const localVerified = Boolean(
      session?.verified && (!session.expiresAt || session.expiresAt > Date.now())
    );
    return res.json({
      verified: localVerified,
      verifiedAt: session?.verifiedAt,
      expiresAt: session?.expiresAt,
      block: SubhdProvider.getBlockState(),
      error: err?.message || 'Failed to check WeChat verification status'
    });
  }
}

export async function handleSubhdWechatReset(_req: Request, res: Response) {
  subhdSession.clear();
  return res.json({ success: true });
}
