#include "vm_inference.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

#define IN AGE_INPUT
#define MB AGE_MAXBUF

static void conv2d_3x3(float *out, const float *in, const float *filt,
					   const float *bias, int h, int w, int ci, int co,
					   int stride, int pad) {
	int oh = (h + stride - 1) / stride;
	int ow = (w + stride - 1) / stride;
	int pad_h = (oh - 1) * stride + 3 - h;
	if (pad_h < 0)
		pad_h = 0;
	int pad_top = pad_h / 2;
	int pad_w = (ow - 1) * stride + 3 - w;
	if (pad_w < 0)
		pad_w = 0;
	int pad_left = pad_w / 2;

	for (int y = 0; y < oh; y++)
		for (int x = 0; x < ow; x++)
			for (int oc = 0; oc < co; oc++) {
				float v = bias[oc];
				for (int fy = 0; fy < 3; fy++) {
					int iy = y * stride - pad_top + fy;
					if (iy < 0 || iy >= h)
						continue;
					for (int fx = 0; fx < 3; fx++) {
						int ix = x * stride - pad_left + fx;
						if (ix < 0 || ix >= w)
							continue;
						const float *ip = in + (iy * w + ix) * ci;
						const float *fp = filt + ((fy * 3 + fx) * ci) * co + oc;
						for (int ic = 0; ic < ci; ic++)
							v += ip[ic] * fp[ic * co];
					}
				}
				out[(y * ow + x) * co + oc] = v;
			}
}

static void conv1x1(float *out, const float *in, const float *filt,
					const float *bias, int h, int w, int ci, int co,
					int stride) {
	int oh = h / stride;
	int ow = w / stride;

	for (int y = 0; y < oh; y++)
		for (int x = 0; x < ow; x++) {
			const float *ip = in + (y * stride * w + x * stride) * ci;
			float *op = out + (y * ow + x) * co;
			for (int oc = 0; oc < co; oc++) {
				float v = bias[oc];
				for (int ic = 0; ic < ci; ic++)
					v += ip[ic] * filt[ic * co + oc];
				op[oc] = v;
			}
		}
}

static void dw_conv3x3(float *out, const float *in, const float *filt, int h,
					   int w, int c) {
	for (int y = 0; y < h; y++)
		for (int x = 0; x < w; x++)
			for (int ch = 0; ch < c; ch++) {
				float v = 0;
				for (int fy = 0; fy < 3; fy++) {
					int iy = y + fy - 1;
					if (iy < 0 || iy >= h)
						continue;
					for (int fx = 0; fx < 3; fx++) {
						int ix = x + fx - 1;
						if (ix < 0 || ix >= w)
							continue;
						v += in[(iy * w + ix) * c + ch] *
							 filt[(fy * 3 + fx) * c + ch];
					}
				}
				out[(y * w + x) * c + ch] = v;
			}
}

static void pw_conv(float *out, const float *in, const float *filt,
					const float *bias, int h, int w, int ci, int co) {
	for (int y = 0; y < h; y++)
		for (int x = 0; x < w; x++) {
			const float *ip = in + (y * w + x) * ci;
			float *op = out + (y * w + x) * co;
			for (int oc = 0; oc < co; oc++) {
				float v = bias[oc];
				for (int ic = 0; ic < ci; ic++)
					v += ip[ic] * filt[ic * co + oc];
				op[oc] = v;
			}
		}
}

static void relu_ip(float *data, int n) {
	for (int i = 0; i < n; i++)
		if (data[i] < 0)
			data[i] = 0;
}

static void maxpool_3x3_s2(float *out, const float *in, int h, int w, int c) {
	int oh = (h + 1) / 2;
	int ow = (w + 1) / 2;
	int pad_h = (oh - 1) * 2 + 3 - h;
	if (pad_h < 0)
		pad_h = 0;
	int pad_top = pad_h / 2;
	int pad_w = (ow - 1) * 2 + 3 - w;
	if (pad_w < 0)
		pad_w = 0;
	int pad_left = pad_w / 2;

	for (int y = 0; y < oh; y++)
		for (int x = 0; x < ow; x++)
			for (int ch = 0; ch < c; ch++) {
				float mx = -1e30f;
				for (int fy = 0; fy < 3; fy++) {
					int iy = y * 2 - pad_top + fy;
					if (iy < 0 || iy >= h)
						continue;
					for (int fx = 0; fx < 3; fx++) {
						int ix = x * 2 - pad_left + fx;
						if (ix < 0 || ix >= w)
							continue;
						float v = in[(iy * w + ix) * c + ch];
						if (v > mx)
							mx = v;
					}
				}
				out[(y * ow + x) * c + ch] = mx;
			}
}

static void gap(float *out, const float *in, int h, int w, int c) {
	float inv = 1.0f / (float)(h * w);
	for (int ch = 0; ch < c; ch++) {
		float s = 0;
		for (int y = 0; y < h; y++)
			for (int x = 0; x < w; x++)
				s += in[(y * w + x) * c + ch];
		out[ch] = s * inv;
	}
}

static void fc(float *out, const float *in, const float *weights,
			   const float *bias, int ni, int no) {
	for (int o = 0; o < no; o++) {
		float v = bias[o];
		for (int i = 0; i < ni; i++)
			v += in[i] * weights[i * no + o];
		out[o] = v;
	}
}

static void add_ip(float *dst, const float *src, int n) {
	for (int i = 0; i < n; i++)
		dst[i] += src[i];
}

static void preprocess(float *out, const uint8_t *rgba, int src_w, int src_h,
					   float box_x, float box_y, float box_w, float box_h) {
	float margin = 0.3f;
	float bx = box_x - box_w * margin;
	float by = box_y - box_h * margin;
	float bw = box_w * (1.0f + 2.0f * margin);
	float bh = box_h * (1.0f + 2.0f * margin);

	float side = bw > bh ? bw : bh;
	float cx_f = (bx + bw * 0.5f) * src_w;
	float cy_f = (by + bh * 0.5f) * src_h;
	float half = side * 0.5f * (bw > bh ? src_w : src_h);

	float x0f = cx_f - half;
	float y0f = cy_f - half;
	float scale = (2.0f * half) / IN;

	for (int y = 0; y < IN; y++) {
		float sy = y0f + (y + 0.5f) * scale - 0.5f;
		int y0 = (int)sy;
		int y1 = y0 + 1;
		float fy = sy - y0;
		if (y0 < 0)
			y0 = 0;
		if (y1 >= src_h)
			y1 = src_h - 1;

		for (int x = 0; x < IN; x++) {
			float sx = x0f + (x + 0.5f) * scale - 0.5f;
			int x0 = (int)sx;
			int x1 = x0 + 1;
			float fx = sx - x0;
			if (x0 < 0)
				x0 = 0;
			if (x1 >= src_w)
				x1 = src_w - 1;

			static const float mean_rgb[3] = {122.782f, 117.001f, 104.298f};
			for (int c = 0; c < 3; c++) {
				float v00 = rgba[(y0 * src_w + x0) * 4 + c];
				float v01 = rgba[(y0 * src_w + x1) * 4 + c];
				float v10 = rgba[(y1 * src_w + x0) * 4 + c];
				float v11 = rgba[(y1 * src_w + x1) * 4 + c];
				float v = v00 * (1 - fx) * (1 - fy) + v01 * fx * (1 - fy) +
						  v10 * (1 - fx) * fy + v11 * fx * fy;
				out[(y * IN + x) * 3 + c] = (v - mean_rgb[c]) / 256.0f;
			}
		}
	}
}

#define LOAD(ptr, n)                                                           \
	do {                                                                       \
		(ptr) = cursor;                                                        \
		cursor += (n);                                                         \
	} while (0)

int age_model_load(AgeModel *m, const float *data, int count) {
	memset(m, 0, sizeof(*m));
	const float *cursor = data;

	LOAD(m->conv_in_w, 3 * 3 * 3 * 32);
	LOAD(m->conv_in_b, 32);

	LOAD(m->rb0_sc0_dw, 3 * 3 * 32);
	LOAD(m->rb0_sc0_pw, 32 * 64);
	LOAD(m->rb0_sc0_b, 64);
	LOAD(m->rb0_sc1_dw, 3 * 3 * 64);
	LOAD(m->rb0_sc1_pw, 64 * 64);
	LOAD(m->rb0_sc1_b, 64);
	LOAD(m->rb0_exp_w, 32 * 64);
	LOAD(m->rb0_exp_b, 64);

	LOAD(m->rb1_sc0_dw, 3 * 3 * 64);
	LOAD(m->rb1_sc0_pw, 64 * 128);
	LOAD(m->rb1_sc0_b, 128);
	LOAD(m->rb1_sc1_dw, 3 * 3 * 128);
	LOAD(m->rb1_sc1_pw, 128 * 128);
	LOAD(m->rb1_sc1_b, 128);
	LOAD(m->rb1_exp_w, 64 * 128);
	LOAD(m->rb1_exp_b, 128);

	LOAD(m->mb0_sc0_dw, 3 * 3 * 128);
	LOAD(m->mb0_sc0_pw, 128 * 128);
	LOAD(m->mb0_sc0_b, 128);
	LOAD(m->mb0_sc1_dw, 3 * 3 * 128);
	LOAD(m->mb0_sc1_pw, 128 * 128);
	LOAD(m->mb0_sc1_b, 128);
	LOAD(m->mb0_sc2_dw, 3 * 3 * 128);
	LOAD(m->mb0_sc2_pw, 128 * 128);
	LOAD(m->mb0_sc2_b, 128);

	LOAD(m->mb1_sc0_dw, 3 * 3 * 128);
	LOAD(m->mb1_sc0_pw, 128 * 128);
	LOAD(m->mb1_sc0_b, 128);
	LOAD(m->mb1_sc1_dw, 3 * 3 * 128);
	LOAD(m->mb1_sc1_pw, 128 * 128);
	LOAD(m->mb1_sc1_b, 128);
	LOAD(m->mb1_sc2_dw, 3 * 3 * 128);
	LOAD(m->mb1_sc2_pw, 128 * 128);
	LOAD(m->mb1_sc2_b, 128);

	LOAD(m->exit_rb_sc0_dw, 3 * 3 * 128);
	LOAD(m->exit_rb_sc0_pw, 128 * 256);
	LOAD(m->exit_rb_sc0_b, 256);
	LOAD(m->exit_rb_sc1_dw, 3 * 3 * 256);
	LOAD(m->exit_rb_sc1_pw, 256 * 256);
	LOAD(m->exit_rb_sc1_b, 256);
	LOAD(m->exit_rb_exp_w, 128 * 256);
	LOAD(m->exit_rb_exp_b, 256);

	LOAD(m->exit_sc_dw, 3 * 3 * 256);
	LOAD(m->exit_sc_pw, 256 * 512);
	LOAD(m->exit_sc_b, 512);

	LOAD(m->fc_age_w, 512);
	LOAD(m->fc_age_b, 1);
	LOAD(m->fc_gender_w, 512 * 2);
	LOAD(m->fc_gender_b, 2);

	int consumed = (int)(cursor - data);
	if (consumed > count)
		return -1;

	for (int i = 0; i < 4; i++) {
		m->buf[i] = (float *)malloc(MB * sizeof(float));
		if (!m->buf[i]) {
			age_model_free(m);
			return -1;
		}
	}

	m->loaded = 1;
	return 0;
}

void age_model_free(AgeModel *m) {
	for (int i = 0; i < 4; i++) {
		free(m->buf[i]);
		m->buf[i] = NULL;
	}
	m->loaded = 0;
}

#define SC(out, tmp, in, dw, pw, b, h, w, ci, co)                              \
	do {                                                                       \
		dw_conv3x3((tmp), (in), (dw), (h), (w), (ci));                         \
		pw_conv((out), (tmp), (pw), (b), (h), (w), (ci), (co));                \
	} while (0)

float age_model_infer(AgeModel *m, const uint8_t *rgba, int width, int height,
					  float box_x, float box_y, float box_w, float box_h) {
	if (!m->loaded)
		return -1.0f;

	float *input = (float *)malloc(IN * IN * 3 * sizeof(float));
	if (!input)
		return -1.0f;

	preprocess(input, rgba, width, height, box_x, box_y, box_w, box_h);

	float *a = m->buf[0];
	float *b = m->buf[1];
	float *skip = m->buf[2];
	float *tmp = m->buf[3];

	conv2d_3x3(a, input, m->conv_in_w, m->conv_in_b, IN, IN, 3, 32, 2, 1);
	relu_ip(a, 56 * 56 * 32);
	free(input);

	conv1x1(skip, a, m->rb0_exp_w, m->rb0_exp_b, 56, 56, 32, 64, 2);
	SC(b, tmp, a, m->rb0_sc0_dw, m->rb0_sc0_pw, m->rb0_sc0_b, 56, 56, 32, 64);
	relu_ip(b, 56 * 56 * 64);
	SC(a, tmp, b, m->rb0_sc1_dw, m->rb0_sc1_pw, m->rb0_sc1_b, 56, 56, 64, 64);
	maxpool_3x3_s2(b, a, 56, 56, 64);
	add_ip(b, skip, 28 * 28 * 64);

	conv1x1(skip, b, m->rb1_exp_w, m->rb1_exp_b, 28, 28, 64, 128, 2);
	memcpy(a, b, 28 * 28 * 64 * sizeof(float));
	relu_ip(a, 28 * 28 * 64);
	SC(b, tmp, a, m->rb1_sc0_dw, m->rb1_sc0_pw, m->rb1_sc0_b, 28, 28, 64, 128);
	relu_ip(b, 28 * 28 * 128);
	SC(a, tmp, b, m->rb1_sc1_dw, m->rb1_sc1_pw, m->rb1_sc1_b, 28, 28, 128, 128);
	maxpool_3x3_s2(b, a, 28, 28, 128);
	add_ip(b, skip, 14 * 14 * 128);

	memcpy(skip, b, 14 * 14 * 128 * sizeof(float));
	relu_ip(b, 14 * 14 * 128);
	SC(a, tmp, b, m->mb0_sc0_dw, m->mb0_sc0_pw, m->mb0_sc0_b, 14, 14, 128, 128);
	relu_ip(a, 14 * 14 * 128);
	SC(b, tmp, a, m->mb0_sc1_dw, m->mb0_sc1_pw, m->mb0_sc1_b, 14, 14, 128, 128);
	relu_ip(b, 14 * 14 * 128);
	SC(a, tmp, b, m->mb0_sc2_dw, m->mb0_sc2_pw, m->mb0_sc2_b, 14, 14, 128, 128);
	add_ip(a, skip, 14 * 14 * 128);

	memcpy(skip, a, 14 * 14 * 128 * sizeof(float));
	relu_ip(a, 14 * 14 * 128);
	SC(b, tmp, a, m->mb1_sc0_dw, m->mb1_sc0_pw, m->mb1_sc0_b, 14, 14, 128, 128);
	relu_ip(b, 14 * 14 * 128);
	SC(a, tmp, b, m->mb1_sc1_dw, m->mb1_sc1_pw, m->mb1_sc1_b, 14, 14, 128, 128);
	relu_ip(a, 14 * 14 * 128);
	SC(b, tmp, a, m->mb1_sc2_dw, m->mb1_sc2_pw, m->mb1_sc2_b, 14, 14, 128, 128);
	add_ip(b, skip, 14 * 14 * 128);

	conv1x1(skip, b, m->exit_rb_exp_w, m->exit_rb_exp_b, 14, 14, 128, 256, 2);
	memcpy(a, b, 14 * 14 * 128 * sizeof(float));
	relu_ip(a, 14 * 14 * 128);
	SC(b, tmp, a, m->exit_rb_sc0_dw, m->exit_rb_sc0_pw, m->exit_rb_sc0_b, 14,
	   14, 128, 256);
	relu_ip(b, 14 * 14 * 256);
	SC(a, tmp, b, m->exit_rb_sc1_dw, m->exit_rb_sc1_pw, m->exit_rb_sc1_b, 14,
	   14, 256, 256);
	maxpool_3x3_s2(b, a, 14, 14, 256);
	add_ip(b, skip, 7 * 7 * 256);

	SC(a, tmp, b, m->exit_sc_dw, m->exit_sc_pw, m->exit_sc_b, 7, 7, 256, 512);
	relu_ip(a, 7 * 7 * 512);

	float pooled[512];
	gap(pooled, a, 7, 7, 512);

	float age;
	fc(&age, pooled, m->fc_age_w, m->fc_age_b, 512, 1);

	return age;
}
