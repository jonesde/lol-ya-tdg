#!/usr/bin/env python3
"""Generate intricate enemy SVG sprites for the-aftermath.json theme - v2."""

import json

def svg_frame(content):
    return f'<svg viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg">{content}</svg>'

# ============================================================
# 1. BAD BUG (minion) - Roach
# ============================================================

def bad_bug_leg(phase, body_y, clench=False):
    """Generate 6 roach legs. clench=True pulls them close to body."""
    paths = []
    lc, lw = "#8a6a3a", "0.06"
    cap = 'stroke-linecap="round"'

    if clench:
        extensions = [(0.06, 0.04), (0.06, 0.04), (0.06, 0.04)]
    else:
        extensions = [(0.28, 0.18), (0.38, 0.22), (0.28, 0.18)]

    for side_sign in [-1, 1]:
        for i, bx in enumerate([0.18, 0.02, -0.18]):
            base_y = body_y + side_sign * 0.33
            leg_phase = (phase + i + (1 if side_sign > 0 else 0)) % 2
            outer, inner = extensions[i]
            if leg_phase == 0:
                if clench:
                    knee_x, knee_y = bx - 0.05, base_y + side_sign * 0.1
                    foot_x, foot_y = bx - 0.1, base_y + side_sign * 0.15
                else:
                    knee_x, knee_y = bx - 0.3, base_y + side_sign * 0.2
                    foot_x, foot_y = bx - 0.48, base_y + side_sign * 0.12
            else:
                if clench:
                    knee_x, knee_y = bx - 0.03, base_y + side_sign * 0.12
                    foot_x, foot_y = bx - 0.08, base_y + side_sign * 0.18
                else:
                    knee_x, knee_y = bx - 0.15, base_y + side_sign * 0.3
                    foot_x, foot_y = bx - 0.35, base_y + side_sign * 0.42
            paths.append(f'<path d="M{bx},{base_y:.2f} L{knee_x:.2f},{knee_y:.2f} L{foot_x:.2f},{foot_y:.2f}" fill="none" stroke="{lc}" stroke-width="{lw}" {cap}/>')
    return "\n".join(paths)


def bad_bug_antennae(wiggle, clench=False):
    if clench:
        top = 'M0.7,-0.12 Q0.75,0.05 0.65,0.15'
        bot = 'M0.7,0.12 Q0.75,-0.05 0.65,-0.15'
    elif wiggle == 0:
        top, bot = 'M0.7,-0.12 Q0.88,-0.35 0.82,-0.5', 'M0.7,0.12 Q0.88,0.35 0.82,0.5'
    elif wiggle == 1:
        top, bot = 'M0.7,-0.12 Q0.92,-0.3 0.95,-0.45', 'M0.7,0.12 Q0.85,0.25 0.78,0.48'
    elif wiggle == 2:
        top, bot = 'M0.7,-0.12 Q0.85,-0.32 0.78,-0.5', 'M0.7,0.12 Q0.85,0.32 0.78,0.5'
    else:
        top, bot = 'M0.7,-0.12 Q0.8,-0.35 0.7,-0.52', 'M0.7,0.12 Q0.9,0.3 0.95,0.44'
    return (f'<path d="{top}" fill="none" stroke="#8a6a3a" stroke-width="0.03" stroke-linecap="round"/>',
            f'<path d="{bot}" fill="none" stroke="#8a6a3a" stroke-width="0.03" stroke-linecap="round"/>')


def bad_bug_body(body_y):
    by = f"{body_y:.2f}"
    return (
        f'<ellipse cx="0" cy="{by}" rx="0.55" ry="0.3" fill="#4a3520" stroke="#2a1a10" stroke-width="0.03"/>'
        f'<ellipse cx="0.52" cy="{by}" rx="0.22" ry="0.18" fill="#3a2a15" stroke="#2a1a10" stroke-width="0.03"/>'
        f'<circle cx="0.62" cy="{body_y - 0.08:.2f}" r="0.04" fill="#2a1a10"/>'
        f'<circle cx="0.62" cy="{body_y + 0.08:.2f}" r="0.04" fill="#2a1a10"/>'
        f'<circle cx="-0.18" cy="{body_y + 0.06:.2f}" r="0.05" fill="#39ff14" opacity="0.7"/>'
        f'<circle cx="-0.33" cy="{body_y - 0.04:.2f}" r="0.04" fill="#39ff14" opacity="0.6"/>'
        f'<circle cx="-0.27" cy="{body_y + 0.16:.2f}" r="0.04" fill="#39ff14" opacity="0.5"/>'
        f'<circle cx="-0.42" cy="{body_y + 0.03:.2f}" r="0.03" fill="#39ff14" opacity="0.4"/>'
        f'<circle cx="-0.12" cy="{body_y - 0.12:.2f}" r="0.03" fill="#39ff14" opacity="0.55"/>'
        f'<path d="M0.15,{body_y - 0.28:.2f} Q0.1,{by} 0.15,{body_y + 0.28:.2f}" fill="none" stroke="#2a1a10" stroke-width="0.02" opacity="0.4"/>'
        f'<path d="M-0.15,{body_y - 0.27:.2f} Q-0.2,{by} -0.15,{body_y + 0.27:.2f}" fill="none" stroke="#2a1a10" stroke-width="0.02" opacity="0.35"/>'
    )


def bad_bug_frame(phase, body_y, wiggle, clench=False):
    inner = "\n".join([bad_bug_body(body_y), bad_bug_leg(phase, body_y, clench),
                       bad_bug_antennae(wiggle, clench)[0], bad_bug_antennae(wiggle, clench)[1]])
    if clench:
        inner = f'<g transform="translate(0.05,0) scale(0.93)">{inner}</g>'
    return svg_frame(inner)


# ============================================================
# 2. MANTIS MANIA (runner) - Praying mantis
# ============================================================

def mantis_body(body_y):
    by = f"{body_y:.2f}"
    return (
        f'<ellipse cx="-0.4" cy="{by}" rx="0.35" ry="0.15" fill="#2d6b2d" stroke="#1a4a1a" stroke-width="0.03"/>'
        + "".join(f'<path d="M{cx},{body_y - dy:.2f} L{cx},{body_y + dy:.2f}" stroke="#1a4a1a" stroke-width="0.02" opacity="0.5"/>'
                    for cx, dy in [(-0.55, 0.12), (-0.45, 0.14), (-0.35, 0.15), (-0.25, 0.14)])
        + f'<ellipse cx="0.0" cy="{by}" rx="0.18" ry="0.12" fill="#3a8a3a" stroke="#2a6a2a" stroke-width="0.03"/>'
        f'<polygon points="0.35,{by} 0.15,{body_y - 0.2:.2f} 0.15,{body_y + 0.2:.2f}" fill="#3d9a3d" stroke="#2a6a2a" stroke-width="0.03"/>'
        f'<circle cx="0.25" cy="{body_y - 0.14:.2f}" r="0.04" fill="#ff2020" stroke="#880000" stroke-width="0.02"/>'
        f'<circle cx="0.25" cy="{body_y + 0.14:.2f}" r="0.04" fill="#ff2020" stroke="#880000" stroke-width="0.02"/>'
        f'<path d="M0.3,{by} L0.38,{body_y - 0.04:.2f}" stroke="#1a4a1a" stroke-width="0.03" stroke-linecap="round"/>'
        f'<path d="M0.3,{by} L0.38,{body_y + 0.04:.2f}" stroke="#1a4a1a" stroke-width="0.03" stroke-linecap="round"/>'
    )


def mantis_scythes(phase, body_y, clench=False):
    by = f"{body_y:.2f}"
    if clench:
        # Tightly folded
        top = f'M0.05,{body_y - 0.1:.2f} L0.08,{body_y - 0.22:.2f} L0.02,{body_y - 0.28:.2f} L0.06,{body_y - 0.32:.2f}'
        bot = f'M0.05,{body_y + 0.1:.2f} L0.08,{body_y + 0.22:.2f} L0.02,{body_y + 0.28:.2f} L0.06,{body_y + 0.32:.2f}'
        spine_top = f'M0.06,{body_y - 0.25:.2f} L0.14,{body_y - 0.22:.2f}'
        spine_bot = f'M0.06,{body_y + 0.25:.2f} L0.14,{body_y + 0.22:.2f}'
    elif phase == 0:
        top = f'M0.05,{body_y - 0.1:.2f} L0.15,{body_y - 0.3:.2f} L0.05,{body_y - 0.35:.2f} L0.1,{body_y - 0.42:.2f}'
        bot = f'M0.05,{body_y + 0.1:.2f} L0.15,{body_y + 0.3:.2f} L0.05,{body_y + 0.35:.2f} L0.1,{body_y + 0.42:.2f}'
        spine_top = f'M0.1,{body_y - 0.35:.2f} L0.2,{body_y - 0.32:.2f} M0.08,{body_y - 0.38:.2f} L0.18,{body_y - 0.35:.2f}'
        spine_bot = f'M0.1,{body_y + 0.35:.2f} L0.2,{body_y + 0.32:.2f} M0.08,{body_y + 0.38:.2f} L0.18,{body_y + 0.35:.2f}'
    else:
        top = f'M0.05,{body_y - 0.1:.2f} L0.3,{body_y - 0.25:.2f} L0.45,{body_y - 0.28:.2f} L0.5,{body_y - 0.38:.2f}'
        bot = f'M0.05,{body_y + 0.1:.2f} L0.3,{body_y + 0.25:.2f} L0.45,{body_y + 0.28:.2f} L0.5,{body_y + 0.38:.2f}'
        spine_top = f'M0.38,{body_y - 0.27:.2f} L0.42,{body_y - 0.2:.2f} M0.45,{body_y - 0.3:.2f} L0.5,{body_y - 0.22:.2f}'
        spine_bot = f'M0.38,{body_y + 0.27:.2f} L0.42,{body_y + 0.2:.2f} M0.45,{body_y + 0.3:.2f} L0.5,{body_y + 0.22:.2f}'
    return (f'<g fill="none" stroke="#4a8a2a" stroke-width="0.06" stroke-linecap="round" stroke-linejoin="round">'
            f'<path d="{top}"/><path d="{spine_top}" stroke-width="0.03"/>'
            f'<path d="{bot}"/><path d="{spine_bot}" stroke-width="0.03"/></g>')


def mantis_legs(phase, body_y, clench=False):
    lc, bw, cap = "#3a7a3a", "0.05", 'stroke-linecap="round" stroke-linejoin="round"'
    legs = []
    positions = [(0.02, -0.1, -0.1), (-0.12, -0.12, -0.05), (0.02, 0.1, -0.1), (-0.12, 0.12, -0.05)]
    for i, (bx, bsign, offset) in enumerate(positions):
        base_y = body_y + bsign
        leg_phase = (phase + i) % 2
        if clench:
            knee_x, knee_y = bx - 0.05, base_y + bsign * 0.15
            foot_x, foot_y = bx - 0.1, base_y + bsign * 0.22
        elif leg_phase == 0:
            knee_x, knee_y = bx - 0.2, base_y + bsign * 0.28
            foot_x, foot_y = bx - 0.45, base_y + bsign * 0.15
        else:
            knee_x, knee_y = bx - 0.12, base_y + bsign * 0.35
            foot_x, foot_y = bx - 0.35, base_y + bsign * 0.45
        legs.append(f'<path d="M{bx},{base_y:.2f} L{knee_x:.2f},{knee_y:.2f} L{foot_x:.2f},{foot_y:.2f}" fill="none" stroke="{lc}" stroke-width="{bw}" {cap}/>')
    return "\n".join(legs)


def mantis_frame(phase, body_y, scythe_phase, clench=False):
    inner = "\n".join([mantis_body(body_y), mantis_scythes(scythe_phase, body_y, clench),
                       mantis_legs(phase, body_y, clench)])
    if clench:
        inner = f'<g transform="translate(0.05,0) scale(0.93)">{inner}</g>'
    return svg_frame(inner)


# ============================================================
# 3. YOW GUY (tank) - Bear with wide stubby legs
# ============================================================

def yow_guy_body(body_y):
    by = f"{body_y:.2f}"
    return (
        f'<ellipse cx="0.0" cy="{by}" rx="0.52" ry="0.38" fill="#8a7a6a" stroke="#4a3a2a" stroke-width="0.04"/>'
        f'<path d="M-0.1,{body_y - 0.33:.2f} L-0.04,{body_y - 0.24:.2f}" stroke="#6a5a4a" stroke-width="0.03"/>'
        f'<path d="M0.06,{body_y - 0.35:.2f} L0.12,{body_y - 0.26:.2f}" stroke="#6a5a4a" stroke-width="0.03"/>'
        f'<path d="M-0.35,{body_y - 0.12:.2f} L-0.26,{body_y - 0.05:.2f}" stroke="#6a5a4a" stroke-width="0.03"/>'
        f'<path d="M0.3,{body_y - 0.18:.2f} L0.35,{body_y - 0.08:.2f}" stroke="#6a5a4a" stroke-width="0.03"/>'
        f'<path d="M-0.22,{body_y + 0.16:.2f} L-0.14,{body_y + 0.09:.2f}" stroke="#6a5a4a" stroke-width="0.03"/>'
        f'<ellipse cx="-0.05" cy="{by}" rx="0.28" ry="0.2" fill="#a89880" opacity="0.5"/>'
        f'<ellipse cx="0.5" cy="{by}" rx="0.24" ry="0.22" fill="#8a7a6a" stroke="#4a3a2a" stroke-width="0.03"/>'
        f'<ellipse cx="0.7" cy="{by}" rx="0.12" ry="0.1" fill="#9a8a7a" stroke="#4a3a2a" stroke-width="0.02"/>'
        f'<ellipse cx="0.78" cy="{by}" rx="0.05" ry="0.04" fill="#ff8899" stroke="#cc5566" stroke-width="0.01"/>'
        f'<circle cx="0.56" cy="{body_y - 0.1:.2f}" r="0.04" fill="#1a1a1a"/>'
        f'<circle cx="0.56" cy="{body_y + 0.1:.2f}" r="0.04" fill="#1a1a1a"/>'
        f'<circle cx="0.38" cy="{body_y - 0.2:.2f}" r="0.07" fill="#7a6a5a" stroke="#4a3a2a" stroke-width="0.02"/>'
        f'<circle cx="0.38" cy="{body_y + 0.2:.2f}" r="0.07" fill="#7a6a5a" stroke="#4a3a2a" stroke-width="0.02"/>'
    )


def yow_guy_leg(phase, body_y, clench=False):
    """Wide stubby bear legs as filled polygons - short and thick."""
    fill_leg, stroke_leg = "#6a5a4a", "#4a3a2a"
    claw_color = "#2a2a2a"
    legs = []

    leg_defs = [(-0.12, -1, 0), (0.18, -1, 1), (-0.12, 1, 0), (0.18, 1, 1)]

    for i, (bx, top_bot, offset_idx) in enumerate(leg_defs):
        sign = top_bot
        base_y = body_y + sign * 0.40
        leg_phase = (phase + offset_idx) % 2

        if clench:
            knee_y = base_y + sign * 0.03
            foot_y = base_y + sign * 0.05
            knee_x = bx
            foot_x = bx - 0.01
            wide_top, wide_bot = 0.13, 0.11
        elif leg_phase == 0:
            knee_y = base_y + sign * 0.06
            foot_y = base_y + sign * 0.12
            knee_x = bx
            foot_x = bx - 0.03
            wide_top, wide_bot = 0.14, 0.1
        else:
            knee_y = base_y + sign * 0.03
            foot_y = base_y + sign * 0.1
            knee_x = bx
            foot_x = bx - 0.04
            wide_top, wide_bot = 0.14, 0.1

        # Each leg is a filled polygon: wide at top, tapering to foot
        # Leg body (filled polygon)
        mid_y = (base_y + knee_y) / 2
        mid_x = (bx + knee_x) / 2

        # Polygon from knee to foot
        half_w1 = wide_top / 2
        half_w2 = wide_bot / 2

        if foot_y > knee_y:  # going down
            poly = (f'M{bx - half_w1:.3f},{base_y:.3f} L{bx + half_w1:.3f},{base_y:.3f} '
                    f'L{knee_x + half_w2:.3f},{knee_y:.3f} L{knee_x - half_w2:.3f},{knee_y:.3f} Z')
            # Thigh segment
            thigh = (f'M{bx - half_w1:.3f},{base_y:.3f} L{knee_x - half_w2:.3f},{knee_y:.3f} '
                     f'L{knee_x - half_w2 - 0.02:.3f},{knee_y + 0.02:.3f} L{bx - half_w1:.3f},{base_y + 0.01:.3f} Z')
        else:  # going up
            poly = (f'M{bx - half_w1:.3f},{base_y:.3f} L{bx + half_w1:.3f},{base_y:.3f} '
                    f'L{knee_x + half_w2:.3f},{knee_y:.3f} L{knee_x - half_w2:.3f},{knee_y:.3f} Z')
            thigh = (f'M{bx - half_w1:.3f},{base_y:.3f} L{knee_x - half_w2:.3f},{knee_y:.3f} '
                     f'L{knee_x - half_w2 - 0.02:.3f},{knee_y - 0.02:.3f} L{bx - half_w1:.3f},{base_y - 0.01:.3f} Z')

        # Foot
        foot_w = 0.1
        if foot_y > knee_y:
            foot_poly = (f'M{knee_x - foot_w/2:.3f},{knee_y:.3f} L{knee_x + foot_w/2:.3f},{knee_y:.3f} '
                         f'L{foot_x + 0.06:.3f},{foot_y:.3f} L{foot_x - 0.06:.3f},{foot_y:.3f} Z')
        else:
            foot_poly = (f'M{knee_x - foot_w/2:.3f},{knee_y:.3f} L{knee_x + foot_w/2:.3f},{knee_y:.3f} '
                         f'L{foot_x + 0.06:.3f},{foot_y:.3f} L{foot_x - 0.06:.3f},{foot_y:.3f} Z')

        legs.append(f'<path d="{poly}" fill="{fill_leg}" stroke="{stroke_leg}" stroke-width="0.02"/>')
        legs.append(f'<path d="{foot_poly}" fill="{fill_leg}" stroke="{stroke_leg}" stroke-width="0.02"/>')

        # Claws
        for claw_offset in [-0.04, 0.0, 0.04]:
            cx, cy = foot_x + claw_offset, foot_y + sign * 0.04
            cx2, cy2 = cx + 0.02, cy + sign * 0.05
            legs.append(f'<line x1="{cx:.3f}" y1="{cy:.3f}" x2="{cx2:.3f}" y2="{cy2:.3f}" stroke="{claw_color}" stroke-width="0.04" stroke-linecap="round"/>')

    return "\n".join(legs)


def yow_guy_frame(phase, body_y, clench=False):
    inner = "\n".join([yow_guy_body(body_y), yow_guy_leg(phase, body_y, clench)])
    if clench:
        inner = f'<g transform="translate(0.04,0) scale(0.93)">{inner}</g>'
    return svg_frame(inner)


# ============================================================
# 4. SHELL SHOCKED (shielded) - Crab
# ============================================================

def shell_body(body_y):
    by = f"{body_y:.2f}"
    return (
        f'<ellipse cx="0.0" cy="{by}" rx="0.4" ry="0.25" fill="#994433" stroke="#662211" stroke-width="0.04"/>'
        f'<path d="M-0.35,{by} Q0,{body_y - 0.22:.2f} 0.35,{by}" fill="none" stroke="#772211" stroke-width="0.03"/>'
        f'<path d="M-0.38,{by} Q0,{body_y + 0.22:.2f} 0.38,{by}" fill="none" stroke="#772211" stroke-width="0.03"/>'
        f'<path d="M-0.2,{by} Q0,{body_y - 0.15:.2f} 0.2,{by}" fill="none" stroke="#aa5544" stroke-width="0.03" opacity="0.5"/>'
        f'<path d="M-0.3,{body_y - 0.1:.2f} L-0.3,{body_y + 0.1:.2f}" stroke="#662211" stroke-width="0.03" opacity="0.6"/>'
        f'<path d="M-0.15,{body_y - 0.22:.2f} L-0.15,{body_y + 0.22:.2f}" stroke="#662211" stroke-width="0.03" opacity="0.4"/>'
        f'<path d="M0.05,{body_y - 0.24:.2f} L0.05,{body_y + 0.24:.2f}" stroke="#662211" stroke-width="0.03" opacity="0.4"/>'
        f'<path d="M0.2,{body_y - 0.2:.2f} L0.2,{body_y + 0.2:.2f}" stroke="#662211" stroke-width="0.03" opacity="0.4"/>'
        f'<line x1="0.3" y1="{body_y - 0.12:.2f}" x2="0.42" y2="{body_y - 0.22:.2f}" stroke="#883322" stroke-width="0.04" stroke-linecap="round"/>'
        f'<circle cx="0.44" cy="{body_y - 0.24:.2f}" r="0.04" fill="#ff4422" stroke="#662211" stroke-width="0.02"/>'
        f'<circle cx="0.44" cy="{body_y - 0.24:.2f}" r="0.02" fill="#1a1a1a"/>'
        f'<line x1="0.3" y1="{body_y + 0.12:.2f}" x2="0.42" y2="{body_y + 0.22:.2f}" stroke="#883322" stroke-width="0.04" stroke-linecap="round"/>'
        f'<circle cx="0.44" cy="{body_y + 0.24:.2f}" r="0.04" fill="#ff4422" stroke="#662211" stroke-width="0.02"/>'
        f'<circle cx="0.44" cy="{body_y + 0.24:.2f}" r="0.02" fill="#1a1a1a"/>'
    )


def shell_pincers(phase, body_y, clench=False):
    by = f"{body_y:.2f}"
    sc, ss = "#cc6644", "0.06"
    cap = 'stroke-linecap="round" stroke-linejoin="round"'

    if clench:
        # Tightly closed
        top = (f'<path d="M0.25,{body_y - 0.15:.2f} L0.38,{body_y - 0.18:.2f} L0.42,{body_y - 0.24:.2f}" fill="none" stroke="{sc}" stroke-width="{ss}" {cap}/>'
               f'<path d="M0.42,{body_y - 0.24:.2f} L0.48,{body_y - 0.28:.2f}" fill="none" stroke="{sc}" stroke-width="0.07" {cap}/>'
               f'<path d="M0.42,{body_y - 0.24:.2f} L0.5,{body_y - 0.2:.2f}" fill="none" stroke="{sc}" stroke-width="0.07" {cap}/>')
        bot = (f'<path d="M0.25,{body_y + 0.15:.2f} L0.38,{body_y + 0.18:.2f} L0.42,{body_y + 0.24:.2f}" fill="none" stroke="{sc}" stroke-width="{ss}" {cap}/>'
               f'<path d="M0.42,{body_y + 0.24:.2f} L0.48,{body_y + 0.28:.2f}" fill="none" stroke="{sc}" stroke-width="0.07" {cap}/>'
               f'<path d="M0.42,{body_y + 0.24:.2f} L0.5,{body_y + 0.2:.2f}" fill="none" stroke="{sc}" stroke-width="0.07" {cap}/>')
    elif phase == 0:
        top = (f'<path d="M0.25,{body_y - 0.15:.2f} L0.45,{body_y - 0.18:.2f} L0.55,{body_y - 0.24:.2f}" fill="none" stroke="{sc}" stroke-width="{ss}" {cap}/>'
               f'<path d="M0.55,{body_y - 0.24:.2f} L0.65,{body_y - 0.32:.2f}" fill="none" stroke="{sc}" stroke-width="0.07" {cap}/>'
               f'<path d="M0.55,{body_y - 0.24:.2f} L0.68,{body_y - 0.2:.2f}" fill="none" stroke="{sc}" stroke-width="0.07" {cap}/>'
               f'<path d="M0.55,{body_y - 0.24:.2f} L0.65,{body_y - 0.32:.2f} L0.7,{body_y - 0.28:.2f} Z" fill="#dd7755" opacity="0.6"/>'
               f'<path d="M0.55,{body_y - 0.24:.2f} L0.68,{body_y - 0.2:.2f} L0.72,{body_y - 0.24:.2f} Z" fill="#dd7755" opacity="0.6"/>')
        bot = (f'<path d="M0.25,{body_y + 0.15:.2f} L0.45,{body_y + 0.18:.2f} L0.55,{body_y + 0.24:.2f}" fill="none" stroke="{sc}" stroke-width="{ss}" {cap}/>'
               f'<path d="M0.55,{body_y + 0.24:.2f} L0.65,{body_y + 0.32:.2f}" fill="none" stroke="{sc}" stroke-width="0.07" {cap}/>'
               f'<path d="M0.55,{body_y + 0.24:.2f} L0.68,{body_y + 0.2:.2f}" fill="none" stroke="{sc}" stroke-width="0.07" {cap}/>'
               f'<path d="M0.55,{body_y + 0.24:.2f} L0.65,{body_y + 0.32:.2f} L0.7,{body_y + 0.28:.2f} Z" fill="#dd7755" opacity="0.6"/>'
               f'<path d="M0.55,{body_y + 0.24:.2f} L0.68,{body_y + 0.2:.2f} L0.72,{body_y + 0.24:.2f} Z" fill="#dd7755" opacity="0.6"/>')
    else:
        top = (f'<path d="M0.25,{body_y - 0.15:.2f} L0.45,{body_y - 0.18:.2f} L0.55,{body_y - 0.22:.2f}" fill="none" stroke="{sc}" stroke-width="{ss}" {cap}/>'
               f'<path d="M0.55,{body_y - 0.22:.2f} L0.7,{body_y - 0.38:.2f}" fill="none" stroke="{sc}" stroke-width="0.07" {cap}/>'
               f'<path d="M0.55,{body_y - 0.22:.2f} L0.72,{body_y - 0.12:.2f}" fill="none" stroke="{sc}" stroke-width="0.07" {cap}/>'
               f'<path d="M0.55,{body_y - 0.22:.2f} L0.7,{body_y - 0.38:.2f} L0.65,{body_y - 0.32:.2f} Z" fill="#dd7755" opacity="0.6"/>'
               f'<path d="M0.55,{body_y - 0.22:.2f} L0.72,{body_y - 0.12:.2f} L0.68,{body_y - 0.18:.2f} Z" fill="#dd7755" opacity="0.6"/>')
        bot = (f'<path d="M0.25,{body_y + 0.15:.2f} L0.45,{body_y + 0.18:.2f} L0.55,{body_y + 0.22:.2f}" fill="none" stroke="{sc}" stroke-width="{ss}" {cap}/>'
               f'<path d="M0.55,{body_y + 0.22:.2f} L0.7,{body_y + 0.38:.2f}" fill="none" stroke="{sc}" stroke-width="0.07" {cap}/>'
               f'<path d="M0.55,{body_y + 0.22:.2f} L0.72,{body_y + 0.12:.2f}" fill="none" stroke="{sc}" stroke-width="0.07" {cap}/>'
               f'<path d="M0.55,{body_y + 0.22:.2f} L0.7,{body_y + 0.38:.2f} L0.65,{body_y + 0.32:.2f} Z" fill="#dd7755" opacity="0.6"/>'
               f'<path d="M0.55,{body_y + 0.22:.2f} L0.72,{body_y + 0.12:.2f} L0.68,{body_y + 0.18:.2f} Z" fill="#dd7755" opacity="0.6"/>')
    return "\n".join([top, bot])


def shell_legs(phase, body_y, clench=False):
    lc, bw = "#aa5533", "0.05"
    cap = 'stroke-linecap="round"'
    legs = []
    for side_sign in [-1, 1]:
        for i, bx in enumerate([-0.15, 0.0, 0.15]):
            base_y = body_y + side_sign * 0.23
            leg_phase = (phase + i + (1 if side_sign > 0 else 0)) % 2
            if clench:
                foot_x = bx + side_sign * 0.08
                foot_y = base_y + side_sign * 0.1
            elif leg_phase == 0:
                foot_x = bx + side_sign * 0.15
                foot_y = base_y + side_sign * 0.2
            else:
                foot_x = bx + side_sign * 0.25
                foot_y = base_y + side_sign * 0.12
            tip_x, tip_y = foot_x + side_sign * 0.04, foot_y + side_sign * 0.03
            legs.append(f'<path d="M{bx},{base_y:.2f} L{foot_x:.2f},{foot_y:.2f} L{tip_x:.2f},{tip_y:.2f}" fill="none" stroke="{lc}" stroke-width="{bw}" {cap}/>')
    return "\n".join(legs)


def shell_frame(phase, body_y, pincer_phase, clench=False):
    inner = "\n".join([shell_body(body_y), shell_pincers(pincer_phase, body_y, clench),
                       shell_legs(phase, body_y, clench)])
    if clench:
        inner = f'<g transform="translate(0.04,0) scale(0.93)">{inner}</g>'
    return svg_frame(inner)


# ============================================================
# 5. MOLE MENDER (healer) - Mole rat
# ============================================================

def mole_body(body_y):
    by = f"{body_y:.2f}"
    return (
        f'<ellipse cx="0.0" cy="{by}" rx="0.35" ry="0.28" fill="#ddd5c8" stroke="#aaa090" stroke-width="0.03"/>'
        f'<ellipse cx="0.38" cy="{by}" rx="0.18" ry="0.15" fill="#e5ddd0" stroke="#aaa090" stroke-width="0.03"/>'
        f'<ellipse cx="0.54" cy="{by}" rx="0.07" ry="0.05" fill="#ffccaa" stroke="#ccaa88" stroke-width="0.02"/>'
        f'<circle cx="0.6" cy="{by}" r="0.03" fill="#ff9988" stroke="#cc7766" stroke-width="0.01"/>'
        f'<circle cx="0.44" cy="{body_y - 0.08:.2f}" r="0.05" fill="#ff6600" stroke="#cc4400" stroke-width="0.02"/>'
        f'<circle cx="0.44" cy="{body_y - 0.08:.2f}" r="0.03" fill="#ffaa00"/>'
        f'<circle cx="0.44" cy="{body_y - 0.08:.2f}" r="0.01" fill="#fff"/>'
        f'<circle cx="0.44" cy="{body_y + 0.08:.2f}" r="0.05" fill="#ff6600" stroke="#cc4400" stroke-width="0.02"/>'
        f'<circle cx="0.44" cy="{body_y + 0.08:.2f}" r="0.03" fill="#ffaa00"/>'
        f'<circle cx="0.44" cy="{body_y + 0.08:.2f}" r="0.01" fill="#fff"/>'
        f'<line x1="0.55" y1="{body_y - 0.04:.2f}" x2="0.68" y2="{body_y - 0.1:.2f}" stroke="#ccc" stroke-width="0.02"/>'
        f'<line x1="0.55" y1="{by}" x2="0.7" y2="{by}" stroke="#ccc" stroke-width="0.02"/>'
        f'<line x1="0.55" y1="{body_y + 0.04:.2f}" x2="0.68" y2="{body_y + 0.1:.2f}" stroke="#ccc" stroke-width="0.02"/>'
        f'<rect x="0.55" y="{body_y - 0.02:.2f}" width="0.04" height="0.04" rx="0.01" fill="#fff" stroke="#ddd" stroke-width="0.01"/>'
        f'<circle cx="0.3" cy="{body_y - 0.14:.2f}" r="0.06" fill="#e5ddd0" stroke="#aaa090" stroke-width="0.02"/>'
        f'<circle cx="0.3" cy="{body_y + 0.14:.2f}" r="0.06" fill="#e5ddd0" stroke="#aaa090" stroke-width="0.02"/>'
        f'<path d="M-0.32,{by} Q-0.5,{body_y - 0.15:.2f} -0.6,{body_y - 0.05:.2f}" fill="none" stroke="#ccc0b0" stroke-width="0.04" stroke-linecap="round"/>'
    )


def mole_legs(phase, body_y, clench=False):
    lc, bw = "#bbb0a0", "0.06"
    cap = 'stroke-linecap="round"'
    legs = []
    leg_defs = [(-0.12, -0.24, -1, 0), (0.08, -0.25, -1, 1), (-0.12, 0.24, 1, 0), (0.08, 0.25, 1, 1)]
    for i, (bx, bsign, side, offset_idx) in enumerate(leg_defs):
        base_y = body_y + bsign
        leg_phase = (phase + offset_idx) % 2
        if clench:
            tip_y = base_y + side * 0.06
        elif leg_phase == 0:
            tip_y = base_y + side * 0.15
        else:
            tip_y = base_y + side * 0.08
        legs.append(f'<line x1="{bx}" y1="{base_y:.2f}" x2="{bx - 0.05:.2f}" y2="{tip_y:.2f}" stroke="{lc}" stroke-width="{bw}" {cap}/>')
        for claw_offset in [-0.03, 0.01]:
            cx, cy = bx - 0.05 + claw_offset, tip_y + side * 0.02
            legs.append(f'<line x1="{bx - 0.05:.2f}" y1="{tip_y:.2f}" x2="{cx:.2f}" y2="{cy:.2f}" stroke="#999" stroke-width="0.02" {cap}/>')
    return "\n".join(legs)


def mole_frame(phase, body_y, glow_intensity, clench=False):
    body = mole_body(body_y)
    legs = mole_legs(phase, body_y, clench)
    if clench:
        glow_opacity, glow_radius = 0.1, 0.04
    else:
        glow_opacity, glow_radius = [0.15, 0.25, 0.4][glow_intensity], [0.06, 0.08, 0.1][glow_intensity]
    glow = (f'<circle cx="0.44" cy="{body_y - 0.08:.2f}" r="{glow_radius:.2f}" fill="#ff8800" opacity="{glow_opacity:.2f}"/>'
            f'<circle cx="0.44" cy="{body_y + 0.08:.2f}" r="{glow_radius:.2f}" fill="#ff8800" opacity="{glow_opacity:.2f}"/>')
    inner = "\n".join([body, legs, glow])
    if clench:
        inner = f'<g transform="translate(0.04,0) scale(0.93)">{inner}</g>'
    return svg_frame(inner)


# ============================================================
# 6. DEATH DRAW (boss) - T-Rex
# ============================================================

def trex_body(body_y):
    by = f"{body_y:.2f}"
    return (
        f'<ellipse cx="-0.05" cy="{by}" rx="0.35" ry="0.22" fill="#5a3a2a" stroke="#3a1a0a" stroke-width="0.04"/>'
        f'<ellipse cx="-0.08" cy="{body_y + 0.08:.2f}" rx="0.25" ry="0.1" fill="#8a6a5a" opacity="0.7"/>'
        f'<path d="M-0.38,{by} Q-0.55,{body_y + 0.08:.2f} -0.75,{body_y - 0.05:.2f} Q-0.85,{body_y - 0.1:.2f} -0.9,{body_y - 0.02:.2f}" fill="#5a3a2a" stroke="#3a1a0a" stroke-width="0.03"/>'
        f'<path d="M0.25,{body_y - 0.05:.2f} L0.4,{body_y - 0.3:.2f}" stroke="#5a3a2a" stroke-width="0.12" stroke-linecap="round"/>'
        f'<path d="M0.28,{body_y - 0.02:.2f} L0.42,{body_y - 0.28:.2f}" stroke="#8a6a5a" stroke-width="0.05" stroke-linecap="round" opacity="0.6"/>'
        f'<ellipse cx="0.48" cy="{body_y - 0.32:.2f}" rx="0.22" ry="0.12" fill="#4a2a1a" stroke="#2a1000" stroke-width="0.04"/>'
        f'<path d="M0.32,{body_y - 0.38:.2f} L0.55,{body_y - 0.44:.2f}" stroke="#3a1a0a" stroke-width="0.04" stroke-linecap="round"/>'
        f'<circle cx="0.58" cy="{body_y - 0.36:.2f}" r="0.04" fill="#ff2020" stroke="#880000" stroke-width="0.02"/>'
        f'<circle cx="0.58" cy="{body_y - 0.36:.2f}" r="0.02" fill="#ff8080"/>'
        f'<circle cx="0.68" cy="{body_y - 0.34:.2f}" r="0.02" fill="#1a1a1a"/>'
    )


def trex_mouth(phase, body_y, clench=False):
    by = f"{body_y:.2f}"
    if clench:
        return (
            f'<path d="M0.38,{body_y - 0.26:.2f} L0.6,{body_y - 0.25:.2f}" stroke="#2a1000" stroke-width="0.03"/>'
            f'<path d="M0.38,{body_y - 0.26:.2f} L0.4,{body_y - 0.2:.2f} L0.58,{body_y - 0.21:.2f}" fill="none" stroke="#2a1000" stroke-width="0.03"/>'
            f'<line x1="0.45" y1="{body_y - 0.26:.2f}" x2="0.45" y2="{body_y - 0.23:.2f}" stroke="#fff" stroke-width="0.03"/>'
            f'<line x1="0.5" y1="{body_y - 0.26:.2f}" x2="0.5" y2="{body_y - 0.23:.2f}" stroke="#fff" stroke-width="0.03"/>'
            f'<line x1="0.55" y1="{body_y - 0.26:.2f}" x2="0.55" y2="{body_y - 0.23:.2f}" stroke="#fff" stroke-width="0.03"/>'
        )
    elif phase == 0:
        return (
            f'<path d="M0.38,{body_y - 0.26:.2f} L0.62,{body_y - 0.26:.2f}" stroke="#2a1000" stroke-width="0.03"/>'
            f'<path d="M0.38,{body_y - 0.26:.2f} L0.4,{body_y - 0.2:.2f} L0.6,{body_y - 0.22:.2f}" fill="none" stroke="#2a1000" stroke-width="0.03"/>'
            f'<line x1="0.45" y1="{body_y - 0.27:.2f}" x2="0.45" y2="{body_y - 0.24:.2f}" stroke="#fff" stroke-width="0.03"/>'
            f'<line x1="0.5" y1="{body_y - 0.27:.2f}" x2="0.5" y2="{body_y - 0.24:.2f}" stroke="#fff" stroke-width="0.03"/>'
            f'<line x1="0.55" y1="{body_y - 0.27:.2f}" x2="0.55" y2="{body_y - 0.24:.2f}" stroke="#fff" stroke-width="0.03"/>'
        )
    elif phase == 1:
        return (
            f'<path d="M0.38,{body_y - 0.26:.2f} L0.64,{body_y - 0.28:.2f}" stroke="#2a1000" stroke-width="0.03"/>'
            f'<path d="M0.38,{body_y - 0.26:.2f} L0.4,{body_y - 0.16:.2f} L0.58,{body_y - 0.18:.2f}" fill="none" stroke="#2a1000" stroke-width="0.03"/>'
            f'<path d="M0.38,{body_y - 0.26:.2f} L0.4,{body_y - 0.16:.2f} L0.58,{body_y - 0.18:.2f} Z" fill="#3a0a0a" opacity="0.6"/>'
            f'<line x1="0.44" y1="{body_y - 0.27:.2f}" x2="0.44" y2="{body_y - 0.21:.2f}" stroke="#fff" stroke-width="0.04"/>'
            f'<line x1="0.49" y1="{body_y - 0.27:.2f}" x2="0.49" y2="{body_y - 0.2:.2f}" stroke="#fff" stroke-width="0.04"/>'
            f'<line x1="0.54" y1="{body_y - 0.28:.2f}" x2="0.54" y2="{body_y - 0.21:.2f}" stroke="#fff" stroke-width="0.04"/>'
            f'<line x1="0.59" y1="{body_y - 0.28:.2f}" x2="0.59" y2="{body_y - 0.22:.2f}" stroke="#fff" stroke-width="0.04"/>'
        )
    else:
        return (
            f'<path d="M0.38,{body_y - 0.26:.2f} L0.66,{body_y - 0.3:.2f}" stroke="#2a1000" stroke-width="0.03"/>'
            f'<path d="M0.38,{body_y - 0.26:.2f} L0.42,{body_y - 0.1:.2f} L0.6,{body_y - 0.14:.2f}" fill="none" stroke="#2a1000" stroke-width="0.03"/>'
            f'<path d="M0.38,{body_y - 0.26:.2f} L0.42,{body_y - 0.1:.2f} L0.6,{body_y - 0.14:.2f} Z" fill="#4a0a0a" opacity="0.7"/>'
            f'<ellipse cx="0.48" cy="{body_y - 0.18:.2f}" rx="0.1" ry="0.04" fill="#5a0a0a" opacity="0.8"/>'
            + "".join(f'<polygon points="{p}" fill="#fff" stroke="#ddd" stroke-width="0.01"/>'
                      for p in [f'0.43,{body_y - 0.27:.2f} 0.41,{body_y - 0.18:.2f} 0.46,{body_y - 0.19:.2f}',
                                f'0.48,{body_y - 0.27:.2f} 0.46,{body_y - 0.16:.2f} 0.51,{body_y - 0.17:.2f}',
                                f'0.53,{body_y - 0.28:.2f} 0.51,{body_y - 0.17:.2f} 0.56,{body_y - 0.18:.2f}',
                                f'0.58,{body_y - 0.29:.2f} 0.56,{body_y - 0.19:.2f} 0.61,{body_y - 0.2:.2f}'])
            + "".join(f'<polygon points="{p}" fill="#fff" stroke="#ddd" stroke-width="0.01"/>'
                      for p in [f'0.43,{body_y - 0.14:.2f} 0.41,{body_y - 0.2:.2f} 0.45,{body_y - 0.19:.2f}',
                                f'0.48,{body_y - 0.13:.2f} 0.47,{body_y - 0.19:.2f} 0.5,{body_y - 0.18:.2f}'])
        )


def trex_legs(phase, body_y, clench=False):
    lc = "#4a2a1a"
    cap = 'stroke-linecap="round" stroke-linejoin="round"'
    legs = []
    for i, bx in enumerate([-0.08, 0.05]):
        base_y = body_y + 0.22
        knee_y = base_y + 0.2
        leg_phase = (phase + i) % 2
        if clench:
            foot_y = knee_y + 0.06
            foot_x_offset = 0.02
        elif leg_phase == 0:
            foot_y = knee_y + 0.15
            foot_x_offset = 0.05
        else:
            foot_y = knee_y + 0.08
            foot_x_offset = -0.05
        legs.append(f'<path d="M{bx},{base_y:.2f} L{bx - 0.02:.2f},{knee_y:.2f}" stroke="{lc}" stroke-width="0.1" {cap}/>')
        legs.append(f'<path d="M{bx - 0.02:.2f},{knee_y:.2f} L{bx + foot_x_offset:.2f},{foot_y:.2f}" stroke="{lc}" stroke-width="0.08" {cap}/>')
        foot_x = bx + foot_x_offset
        legs.append(f'<path d="M{foot_x:.2f},{foot_y:.2f} L{foot_x - 0.08:.2f},{foot_y + 0.03:.2f}" stroke="#3a1a0a" stroke-width="0.06" {cap}/>')
        for claw_offset in [-0.06, -0.02, 0.02]:
            legs.append(f'<line x1="{foot_x + claw_offset:.2f}" y1="{foot_y + 0.04:.2f}" x2="{foot_x + claw_offset + 0.02:.2f}" y2="{foot_y + 0.1:.2f}" stroke="#1a1a1a" stroke-width="0.04" {cap}/>')
    return "\n".join(legs)


def trex_arms(body_y, clench=False):
    by = f"{body_y:.2f}"
    if clench:
        return (
            f'<line x1="0.22" y1="{body_y - 0.05:.2f}" x2="0.28" y2="{body_y - 0.1:.2f}" stroke="#5a3a2a" stroke-width="0.05" stroke-linecap="round"/>'
            f'<line x1="0.18" y1="{body_y + 0.1:.2f}" x2="0.25" y2="{body_y + 0.15:.2f}" stroke="#5a3a2a" stroke-width="0.05" stroke-linecap="round"/>'
        )
    return (
        f'<line x1="0.22" y1="{body_y - 0.05:.2f}" x2="0.35" y2="{body_y - 0.15:.2f}" stroke="#5a3a2a" stroke-width="0.05" stroke-linecap="round"/>'
        f'<line x1="0.35" y1="{body_y - 0.15:.2f}" x2="0.38" y2="{body_y - 0.08:.2f}" stroke="#5a3a2a" stroke-width="0.04" stroke-linecap="round"/>'
        f'<line x1="0.38" y1="{body_y - 0.08:.2f}" x2="0.42" y2="{body_y - 0.05:.2f}" stroke="#3a1a0a" stroke-width="0.02" stroke-linecap="round"/>'
        f'<line x1="0.38" y1="{body_y - 0.08:.2f}" x2="0.41" y2="{body_y - 0.12:.2f}" stroke="#3a1a0a" stroke-width="0.02" stroke-linecap="round"/>'
        f'<line x1="0.18" y1="{body_y + 0.1:.2f}" x2="0.32" y2="{body_y + 0.18:.2f}" stroke="#5a3a2a" stroke-width="0.05" stroke-linecap="round"/>'
        f'<line x1="0.32" y1="{body_y + 0.18:.2f}" x2="0.36" y2="{body_y + 0.12:.2f}" stroke="#5a3a2a" stroke-width="0.04" stroke-linecap="round"/>'
        f'<line x1="0.36" y1="{body_y + 0.12:.2f}" x2="0.4" y2="{body_y + 0.08:.2f}" stroke="#3a1a0a" stroke-width="0.02" stroke-linecap="round"/>'
        f'<line x1="0.36" y1="{body_y + 0.12:.2f}" x2="0.4" y2="{body_y + 0.15:.2f}" stroke="#3a1a0a" stroke-width="0.02" stroke-linecap="round"/>'
    )


def trex_frame(phase, body_y, mouth_phase, clench=False):
    inner = "\n".join([trex_body(body_y), trex_arms(body_y, clench),
                       trex_legs(phase, body_y, clench), trex_mouth(mouth_phase, body_y, clench)])
    if clench:
        inner = f'<g transform="translate(0.04,0) scale(0.93)">{inner}</g>'
    return svg_frame(inner)


# ============================================================
# FRAME GENERATION
# ============================================================

body_bobs = [0.0, 0.02, 0.04, 0.02, 0.0, -0.02, -0.04, -0.02]
antenna_wiggle = [0, 1, 2, 1, 0, 1, 2, 1]
scythe_phases = [0, 0, 1, 0, 0, 0, 1, 0]
pincer_phases = [0, 0, 0, 1, 0, 0, 0, 1]
glow_levels = [0, 1, 2, 1, 0, 1, 2, 1]
mouth_phases = [0, 1, 2, 1, 0, 1, 2, 1]


def make_walk_frames(frame_func, extra_arrays):
    frames = []
    for i in range(8):
        args = [i % 4, body_bobs[i]] + [arr[i] for arr in extra_arrays] + [False]
        frame_svg = frame_func(*args)
        frames.append({"image": frame_svg.replace(' xmlns="http://www.w3.org/2000/svg"', '')})
    return frames


def make_hit_frames(frame_func, extra_arrays):
    """3 hit reaction frames using clench + subtle scale."""
    frames = []
    for scale, body_y in [(0.98, 0.0), (0.95, 0.003), (0.98, -0.0)]:
        if len(extra_arrays) > 0:
            args = [2, body_y] + [arr[0] if isinstance(arr, list) else 0 for arr in extra_arrays] + [True]
        else:
            args = [2, body_y, True]
        frame_svg = frame_func(*args)
        frame_svg = frame_svg.replace('scale(0.93)', f'scale({scale})')
        frames.append({"image": frame_svg.replace(' xmlns="http://www.w3.org/2000/svg"', '')})
    return frames


# Build all walking frames
minion_walking = make_walk_frames(bad_bug_frame, [antenna_wiggle])
runner_walking = make_walk_frames(mantis_frame, [scythe_phases])
tank_walking = make_walk_frames(yow_guy_frame, [])
shielded_walking = make_walk_frames(shell_frame, [pincer_phases])
healer_walking = make_walk_frames(mole_frame, [glow_levels])
boss_walking = make_walk_frames(trex_frame, [mouth_phases])

# Build all hit reaction frames (clench-based)
minion_hit = make_hit_frames(bad_bug_frame, [antenna_wiggle])
runner_hit = make_hit_frames(mantis_frame, [scythe_phases])
tank_hit = make_hit_frames(yow_guy_frame, [])
shielded_hit = make_hit_frames(shell_frame, [pincer_phases])
healer_hit = make_hit_frames(mole_frame, [glow_levels])
boss_hit = make_hit_frames(trex_frame, [mouth_phases])

# Build enemies section
enemies = {
    "minion": {"name": "Bad Bug", "color": "#88aa44", "shape": "●",
               "walking": {"duration": 0.8, "frames": minion_walking},
               "hitReaction": {"duration": 0.3, "frames": minion_hit}},
    "runner": {"name": "Manic Mantis", "color": "#44aa44", "shape": "◆",
               "walking": {"duration": 0.6, "frames": runner_walking},
               "hitReaction": {"duration": 0.3, "frames": runner_hit}},
    "tank": {"name": "Yow Guy", "color": "#886644", "shape": "■",
             "walking": {"duration": 1.0, "frames": tank_walking},
             "hitReaction": {"duration": 0.3, "frames": tank_hit}},
    "shielded": {"name": "Shell Shocked", "color": "#99aabb", "shape": "◇",
                 "walking": {"duration": 0.7, "frames": shielded_walking},
                 "hitReaction": {"duration": 0.3, "frames": shielded_hit}},
    "healer": {"name": "Mole Mender", "color": "#bb77aa", "shape": "▲",
               "walking": {"duration": 0.9, "frames": healer_walking},
               "hitReaction": {"duration": 0.3, "frames": healer_hit}},
    "boss": {"name": "Death Draw", "color": "#cc6600", "shape": "★",
             "walking": {"duration": 1.2, "frames": boss_walking},
             "hitReaction": {"duration": 0.4, "frames": boss_hit}},
}

print(json.dumps(enemies, indent=2, ensure_ascii=False))