"""Assemble viewer frames (dev/scripts/m7Frames.mjs) into side-by-side looping GIFs for the checkpoint reports.

Usage: python tools/noise/frames_to_gif.py <out.gif> <frames dir> [<frames dir> ...] [--labels a,b,...] [--ms 80]
"""
import argparse
import glob
import os

from PIL import Image, ImageDraw


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('dirs', nargs='+')
    ap.add_argument('--labels', default='')
    ap.add_argument('--ms', type=int, default=80)
    a = ap.parse_args()
    labels = a.labels.split(',') if a.labels else [os.path.basename(d) for d in a.dirs]
    seqs = [sorted(glob.glob(os.path.join(d, 'f*.png'))) for d in a.dirs]
    n = min(len(s) for s in seqs)
    frames = []
    for k in range(n):
        ims = [Image.open(s[k]).convert('RGB') for s in seqs]
        w, h = ims[0].size
        sheet = Image.new('RGB', (len(ims) * (w + 4) - 4, h + 16), 'white')
        d = ImageDraw.Draw(sheet)
        for i, (im, lab) in enumerate(zip(ims, labels)):
            sheet.paste(im, (i * (w + 4), 16))
            d.text((i * (w + 4) + 3, 2), lab, fill='black')
        frames.append(sheet.quantize(colors=128, method=Image.Quantize.MEDIANCUT))
    frames[0].save(a.out, save_all=True, append_images=frames[1:], duration=a.ms, loop=0, optimize=True)
    print(f'{a.out}: {n} frames, {os.path.getsize(a.out) / 1e6:.2f} MB')


if __name__ == '__main__':
    main()
