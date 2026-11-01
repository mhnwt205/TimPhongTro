-- Apply the new public brand to editable copy without overwriting unrelated text.
UPDATE website_settings SET
 home_title=replace(home_title,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 home_subtitle=replace(home_subtitle,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 home_photo_caption=replace(home_photo_caption,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 seller_cta_title=replace(seller_cta_title,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 seller_cta_body=replace(seller_cta_body,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 pricing_banner_title=replace(pricing_banner_title,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 pricing_banner_body=replace(pricing_banner_body,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 free_posts_title=replace(free_posts_title,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 free_posts_body=replace(free_posts_body,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 faq_title=replace(faq_title,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 faq_1_question=replace(faq_1_question,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 faq_1_answer=replace(faq_1_answer,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 faq_2_question=replace(faq_2_question,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 faq_2_answer=replace(faq_2_answer,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 faq_3_question=replace(faq_3_question,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 faq_3_answer=replace(faq_3_answer,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 faq_4_question=replace(faq_4_question,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 faq_4_answer=replace(faq_4_answer,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 guide_title=replace(guide_title,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 guide_subtitle=replace(guide_subtitle,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 guide_step_1_title=replace(guide_step_1_title,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 guide_step_1_body=replace(guide_step_1_body,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 guide_step_2_title=replace(guide_step_2_title,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 guide_step_2_body=replace(guide_step_2_body,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 guide_step_3_title=replace(guide_step_3_title,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 guide_step_3_body=replace(guide_step_3_body,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 guide_note_title=replace(guide_note_title,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 guide_note_body=replace(guide_note_body,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 footer_description=replace(footer_description,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 footer_caption=replace(footer_caption,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 disclaimer_title=replace(disclaimer_title,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 disclaimer_before_report=replace(disclaimer_before_report,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 disclaimer_after_report=replace(disclaimer_after_report,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
 version=version+1,updated_at=unixepoch()
WHERE id=1 AND (
 instr(home_title,'Tìm Phòng Trọ')>0
 OR instr(home_subtitle,'Tìm Phòng Trọ')>0
 OR instr(home_photo_caption,'Tìm Phòng Trọ')>0
 OR instr(seller_cta_title,'Tìm Phòng Trọ')>0
 OR instr(seller_cta_body,'Tìm Phòng Trọ')>0
 OR instr(pricing_banner_title,'Tìm Phòng Trọ')>0
 OR instr(pricing_banner_body,'Tìm Phòng Trọ')>0
 OR instr(free_posts_title,'Tìm Phòng Trọ')>0
 OR instr(free_posts_body,'Tìm Phòng Trọ')>0
 OR instr(faq_title,'Tìm Phòng Trọ')>0
 OR instr(faq_1_question,'Tìm Phòng Trọ')>0
 OR instr(faq_1_answer,'Tìm Phòng Trọ')>0
 OR instr(faq_2_question,'Tìm Phòng Trọ')>0
 OR instr(faq_2_answer,'Tìm Phòng Trọ')>0
 OR instr(faq_3_question,'Tìm Phòng Trọ')>0
 OR instr(faq_3_answer,'Tìm Phòng Trọ')>0
 OR instr(faq_4_question,'Tìm Phòng Trọ')>0
 OR instr(faq_4_answer,'Tìm Phòng Trọ')>0
 OR instr(guide_title,'Tìm Phòng Trọ')>0
 OR instr(guide_subtitle,'Tìm Phòng Trọ')>0
 OR instr(guide_step_1_title,'Tìm Phòng Trọ')>0
 OR instr(guide_step_1_body,'Tìm Phòng Trọ')>0
 OR instr(guide_step_2_title,'Tìm Phòng Trọ')>0
 OR instr(guide_step_2_body,'Tìm Phòng Trọ')>0
 OR instr(guide_step_3_title,'Tìm Phòng Trọ')>0
 OR instr(guide_step_3_body,'Tìm Phòng Trọ')>0
 OR instr(guide_note_title,'Tìm Phòng Trọ')>0
 OR instr(guide_note_body,'Tìm Phòng Trọ')>0
 OR instr(footer_description,'Tìm Phòng Trọ')>0
 OR instr(footer_caption,'Tìm Phòng Trọ')>0
 OR instr(disclaimer_title,'Tìm Phòng Trọ')>0
 OR instr(disclaimer_before_report,'Tìm Phòng Trọ')>0
 OR instr(disclaimer_after_report,'Tìm Phòng Trọ')>0
);

UPDATE content_pages
SET title=replace(title,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
    body=replace(body,'Tìm Phòng Trọ','Trọ Tốt TP.HCM'),
    version=version+1,change_token=lower(hex(randomblob(16))),updated_at=unixepoch()
WHERE instr(title,'Tìm Phòng Trọ')>0 OR instr(body,'Tìm Phòng Trọ')>0;
