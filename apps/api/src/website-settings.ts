export type WebsiteSettings = {
 id: number;
 home_title: string;
 home_subtitle: string;
 home_photo_caption: string;
 seller_cta_title: string;
 seller_cta_body: string;
 pricing_banner_title: string;
 pricing_banner_body: string;
 free_posts_title: string;
 free_posts_body: string;
 free_posts_new_account: number;
 faq_title: string;
 faq_1_question: string; faq_1_answer: string;
 faq_2_question: string; faq_2_answer: string;
 faq_3_question: string; faq_3_answer: string;
 faq_4_question: string; faq_4_answer: string;
 guide_title: string;
 guide_subtitle: string;
 guide_step_1_title: string; guide_step_1_body: string;
 guide_step_2_title: string; guide_step_2_body: string;
 guide_step_3_title: string; guide_step_3_body: string;
 guide_note_title: string; guide_note_body: string;
 footer_description: string;
 footer_caption: string;
 disclaimer_title: string;
 disclaimer_before_report: string;
 disclaimer_after_report: string;
 version: number;
 updated_at: number;
};

export const websiteTextFields = [
 'home_title','home_subtitle','home_photo_caption','seller_cta_title','seller_cta_body',
 'pricing_banner_title','pricing_banner_body','free_posts_title','free_posts_body','faq_title',
 'faq_1_question','faq_1_answer','faq_2_question','faq_2_answer','faq_3_question','faq_3_answer',
 'faq_4_question','faq_4_answer','guide_title','guide_subtitle','guide_step_1_title','guide_step_1_body',
 'guide_step_2_title','guide_step_2_body','guide_step_3_title','guide_step_3_body','guide_note_title',
 'guide_note_body','footer_description','footer_caption','disclaimer_title','disclaimer_before_report',
 'disclaimer_after_report',
] as const;

export async function getWebsiteSettings(db: D1Database): Promise<WebsiteSettings> {
 const row=await db.prepare('SELECT * FROM website_settings WHERE id=1').first<WebsiteSettings>();
 if(!row)throw new Error('website_settings_not_configured');
 return row;
}
