import { refuse } from "./errors.js";
import { safeName } from "./names.js";
/** Used when a body has no colour. */
export const DEFAULT_COLOR = "#cccccc";
export const MATERIAL_METALLIC = 0;
export const MATERIAL_ROUGHNESS = 0.8;
function srgbToLinear(value) {
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(value) {
    return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}
/**
 * Reads a colour and returns it as sRGB bytes. Colours are kept at eight bits per channel, so
 * a material name and its colour always match one to one. `where` starts the message of a
 * refusal: the body, and the triangle for a face colour.
 */
export function colorBytes(color, colorSpace, where) {
    const input = color ?? DEFAULT_COLOR;
    if (typeof input === "string") {
        const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim())?.[1];
        if (hex === undefined) {
            refuse("BAD_COLOR", `${where}: colour "${input}" is not "#rrggbb" or "#rgb". Transparency is not supported.`);
        }
        const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
        return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16));
    }
    if (!Array.isArray(input) || input.length !== 3 || !input.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 1)) {
        refuse("BAD_COLOR", `${where}: colour must be a hex string or [r, g, b] with each channel from 0 to 1.`);
    }
    return input.map((channel) => Math.round((colorSpace === "linear" ? linearToSrgb(channel) : channel) * 255));
}
function hexOf(bytes) {
    return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
/**
 * Reads every colour of every body. One material per distinct colour: a body that names its
 * material gets a material of that name for its own colour, and every other colour is named
 * after itself. Two uses of one name must have the same colour.
 *
 * A face colour that is the body's own colour is the body's own material, whatever it is named,
 * so a body never has two materials of one colour.
 */
export function planColors(bodies, colorSpace) {
    const candidates = [];
    const byName = new Map();
    const candidate = (name, bytes, hex, bodyName) => {
        const existing = byName.get(name);
        if (existing !== undefined) {
            const material = candidates[existing];
            if (material.color !== `#${hex}`) {
                refuse("MATERIAL_CONFLICT", `Material "${name}" is used with two colours, ${material.color} and #${hex} (body "${bodyName}"). Give each colour its own material name.`);
            }
            return existing;
        }
        const linear = bytes.map((byte) => Math.round(srgbToLinear(byte / 255) * 1e6) / 1e6);
        candidates.push({ name, color: `#${hex}`, baseColorFactor: [linear[0], linear[1], linear[2], 1], bodies: 0 });
        byName.set(name, candidates.length - 1);
        return candidates.length - 1;
    };
    const ofBody = [];
    const ofTriangle = [];
    for (const body of bodies) {
        const where = `Body "${body.name}"`;
        const bytes = colorBytes(body.color, colorSpace, where);
        const ownHex = hexOf(bytes);
        if (body.materialName !== undefined && (typeof body.materialName !== "string" || body.materialName.trim() === "")) {
            refuse("BAD_NAME", `${where}: materialName must be a string with at least one character.`);
        }
        const own = candidate(body.materialName === undefined ? `color_${ownHex}` : safeName(body.materialName, "material"), bytes, ownHex, body.name);
        ofBody.push(own);
        const { faceColors } = body;
        if (faceColors === undefined) {
            ofTriangle.push(undefined);
            continue;
        }
        const triangles = new Uint32Array(faceColors.length);
        // Most bodies repeat a few colours over many triangles, so each spelling is read once.
        const byText = new Map();
        const byHex = new Map([[ownHex, own]]);
        for (let triangle = 0; triangle < faceColors.length; triangle += 1) {
            const entry = faceColors[triangle];
            if (entry === undefined || entry === null) {
                triangles[triangle] = own;
                continue;
            }
            let found = typeof entry === "string" ? byText.get(entry) : undefined;
            if (found === undefined) {
                const faceBytes = colorBytes(entry, colorSpace, `${where}, triangle ${triangle}`);
                const hex = hexOf(faceBytes);
                found = byHex.get(hex);
                if (found === undefined) {
                    found = candidate(`color_${hex}`, faceBytes, hex, body.name);
                    byHex.set(hex, found);
                }
                if (typeof entry === "string")
                    byText.set(entry, found);
            }
            triangles[triangle] = found;
        }
        ofTriangle.push(triangles);
    }
    return { candidates, ofBody, ofTriangle };
}
