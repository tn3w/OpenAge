#ifndef VM_INFERENCE_H
#define VM_INFERENCE_H

#include <stdint.h>

#define AGE_INPUT 112
#define AGE_MAXBUF (56 * 56 * 64)

typedef struct {
	const float *conv_in_w, *conv_in_b;

	const float *rb0_sc0_dw, *rb0_sc0_pw, *rb0_sc0_b;
	const float *rb0_sc1_dw, *rb0_sc1_pw, *rb0_sc1_b;
	const float *rb0_exp_w, *rb0_exp_b;

	const float *rb1_sc0_dw, *rb1_sc0_pw, *rb1_sc0_b;
	const float *rb1_sc1_dw, *rb1_sc1_pw, *rb1_sc1_b;
	const float *rb1_exp_w, *rb1_exp_b;

	const float *mb0_sc0_dw, *mb0_sc0_pw, *mb0_sc0_b;
	const float *mb0_sc1_dw, *mb0_sc1_pw, *mb0_sc1_b;
	const float *mb0_sc2_dw, *mb0_sc2_pw, *mb0_sc2_b;

	const float *mb1_sc0_dw, *mb1_sc0_pw, *mb1_sc0_b;
	const float *mb1_sc1_dw, *mb1_sc1_pw, *mb1_sc1_b;
	const float *mb1_sc2_dw, *mb1_sc2_pw, *mb1_sc2_b;

	const float *exit_rb_sc0_dw, *exit_rb_sc0_pw;
	const float *exit_rb_sc0_b;
	const float *exit_rb_sc1_dw, *exit_rb_sc1_pw;
	const float *exit_rb_sc1_b;
	const float *exit_rb_exp_w, *exit_rb_exp_b;

	const float *exit_sc_dw, *exit_sc_pw, *exit_sc_b;

	const float *fc_age_w, *fc_age_b;
	const float *fc_gender_w, *fc_gender_b;

	float *buf[4];
	int loaded;
} AgeModel;

int age_model_load(AgeModel *model, const float *data, int count);
float age_model_infer(AgeModel *model, const uint8_t *rgba, int width,
					  int height, float box_x, float box_y, float box_w,
					  float box_h);
void age_model_free(AgeModel *model);

#endif
