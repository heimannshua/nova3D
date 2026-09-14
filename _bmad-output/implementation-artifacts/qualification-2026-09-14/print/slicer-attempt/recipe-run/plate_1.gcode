; HEADER_BLOCK_START
; BambuStudio 02.08.02.61
; model printing time: 35m 30s; total estimated time: 35m 49s
; total layer number: 200
; total filament length [mm] : 7608.21
; total filament volume [cm^3] : 18299.88
; total filament weight [g] : 23.24
; filament_density: 1.27
; filament_diameter: 1.75
; max_z_height: 40.00
; filament: 1
; support_material_on_wipe_tower: 0
; HEADER_BLOCK_END

; CONFIG_BLOCK_START
; accel_to_decel_enable = 0
; accel_to_decel_factor = 50%
; activate_air_filtration = 0
; additional_cooling_fan_speed = 70
; additional_fan_full_speed_layer = 0
; alternate_extra_wall = 0
; ams_filament_load_time_ams = 0
; ams_filament_load_time_ams_lite = 0
; ams_filament_load_time_n3f_s = 0
; ams_filament_unload_time_ams = 0
; ams_filament_unload_time_ams_lite = 0
; ams_filament_unload_time_n3f_s = 0
; apply_scarf_seam_on_circles = 1
; auxiliary_fan = 0
; avoid_crossing_wall_includes_support = 0
; bed_custom_model = 
; bed_custom_texture = 
; bed_exclude_area = 
; bed_heat_soak_area = 
; bed_temperature_formula = by_first_filament
; before_layer_change_gcode = 
; best_object_pos = 0.7,0.5
; bottom_color_penetration_layers = 3
; bottom_shell_layers = 3
; bottom_shell_thickness = 0
; bottom_surface_density = 100%
; bottom_surface_pattern = monotonic
; bridge_angle = 0
; bridge_flow = 1
; bridge_no_support = 0
; bridge_speed = 50
; brim_object_gap = 0.1
; brim_type = auto_brim
; brim_width = 5
; chamber_temperatures = 0
; change_filament_gcode = M620 S[next_extruder]A\nM204 S9000\nG1 Z{max_layer_z + 3.0} F1200\n\nG1 X70 F21000\nG1 Y245\nG1 Y265 F3000\nM400\nM106 P1 S0\nM106 P2 S0\n{if old_filament_temp > 142 && next_extruder < 255}\nM104 S[old_filament_temp]\n{endif}\nG1 X90 F3000\nG1 Y255 F4000\nG1 X100 F5000\nG1 X120 F15000\n\nG1 X20 Y50 F21000\nG1 Y-3\n{if toolchange_count == 2}\n; get travel path for change filament\nM620.1 X[travel_point_1_x] Y[travel_point_1_y] F21000 P0\nM620.1 X[travel_point_2_x] Y[travel_point_2_y] F21000 P1\nM620.1 X[travel_point_3_x] Y[travel_point_3_y] F21000 P2\n{endif}\nM620.1 E F[old_filament_e_feedrate] T{nozzle_temperature_range_high[previous_extruder]}\nT[next_extruder]\nM620.1 E F[new_filament_e_feedrate] T{nozzle_temperature_range_high[next_extruder]}\n\n{if next_extruder < 255}\nM400\n\nG92 E0\n{if flush_length_1 > 1}\n; FLUSH_START\n; always use highest temperature to flush\nM400\nM109 S[nozzle_temperature_range_high]\n{if flush_length_1 > 23.7}\nG1 E23.7 F{old_filament_e_feedrate} ; do not need pulsatile flushing for start part\nG1 E{(flush_length_1 - 23.7) * 0.02} F50\nG1 E{(flush_length_1 - 23.7) * 0.23} F{old_filament_e_feedrate}\nG1 E{(flush_length_1 - 23.7) * 0.02} F50\nG1 E{(flush_length_1 - 23.7) * 0.23} F{new_filament_e_feedrate}\nG1 E{(flush_length_1 - 23.7) * 0.02} F50\nG1 E{(flush_length_1 - 23.7) * 0.23} F{new_filament_e_feedrate}\nG1 E{(flush_length_1 - 23.7) * 0.02} F50\nG1 E{(flush_length_1 - 23.7) * 0.23} F{new_filament_e_feedrate}\n{else}\nG1 E{flush_length_1} F{old_filament_e_feedrate}\n{endif}\n; FLUSH_END\nG1 E-[old_retract_length_toolchange] F1800\nG1 E[old_retract_length_toolchange] F300\n{endif}\n\n{if flush_length_2 > 1}\n; FLUSH_START\nG1 E{flush_length_2 * 0.18} F{new_filament_e_feedrate}\nG1 E{flush_length_2 * 0.02} F50\nG1 E{flush_length_2 * 0.18} F{new_filament_e_feedrate}\nG1 E{flush_length_2 * 0.02} F50\nG1 E{flush_length_2 * 0.18} F{new_filament_e_feedrate}\nG1 E{flush_length_2 * 0.02} F50\nG1 E{flush_length_2 * 0.18} F{new_filament_e_feedrate}\nG1 E{flush_length_2 * 0.02} F50\nG1 E{flush_length_2 * 0.18} F{new_filament_e_feedrate}\nG1 E{flush_length_2 * 0.02} F50\n; FLUSH_END\nG1 E-[new_retract_length_toolchange] F1800\nG1 E[new_retract_length_toolchange] F300\n{endif}\n\n{if flush_length_3 > 1}\n; FLUSH_START\nG1 E{flush_length_3 * 0.18} F{new_filament_e_feedrate}\nG1 E{flush_length_3 * 0.02} F50\nG1 E{flush_length_3 * 0.18} F{new_filament_e_feedrate}\nG1 E{flush_length_3 * 0.02} F50\nG1 E{flush_length_3 * 0.18} F{new_filament_e_feedrate}\nG1 E{flush_length_3 * 0.02} F50\nG1 E{flush_length_3 * 0.18} F{new_filament_e_feedrate}\nG1 E{flush_length_3 * 0.02} F50\nG1 E{flush_length_3 * 0.18} F{new_filament_e_feedrate}\nG1 E{flush_length_3 * 0.02} F50\n; FLUSH_END\nG1 E-[new_retract_length_toolchange] F1800\nG1 E[new_retract_length_toolchange] F300\n{endif}\n\n{if flush_length_4 > 1}\n; FLUSH_START\nG1 E{flush_length_4 * 0.18} F{new_filament_e_feedrate}\nG1 E{flush_length_4 * 0.02} F50\nG1 E{flush_length_4 * 0.18} F{new_filament_e_feedrate}\nG1 E{flush_length_4 * 0.02} F50\nG1 E{flush_length_4 * 0.18} F{new_filament_e_feedrate}\nG1 E{flush_length_4 * 0.02} F50\nG1 E{flush_length_4 * 0.18} F{new_filament_e_feedrate}\nG1 E{flush_length_4 * 0.02} F50\nG1 E{flush_length_4 * 0.18} F{new_filament_e_feedrate}\nG1 E{flush_length_4 * 0.02} F50\n; FLUSH_END\n{endif}\n; FLUSH_START\nM400\nM109 S[new_filament_temp]\nG1 E2 F{new_filament_e_feedrate} ;Compensate for filament spillage during waiting temperature\n; FLUSH_END\nM400\nG92 E0\nG1 E-[new_retract_length_toolchange] F1800\nM106 P1 S255\nM400 S3\nG1 X80 F15000\nG1 X60 F15000\nG1 X80 F15000\nG1 X60 F15000; shake to put down garbage\n\nG1 X70 F5000\nG1 X90 F3000\nG1 Y255 F4000\nG1 X100 F5000\nG1 Y265 F5000\nG1 X70 F10000\nG1 X100 F5000\nG1 X70 F10000\nG1 X100 F5000\nG1 X165 F15000; wipe and shake\nG1 Y256 ; move Y to aside, prevent collision\nM400\nG1 Z{max_layer_z + 3.0} F3000\n{if layer_z <= (initial_layer_print_height + 0.001)}\nM204 S[initial_layer_acceleration]\n{else}\nM204 S[default_acceleration]\n{endif}\n{else}\nG1 X[x_after_toolchange] Y[y_after_toolchange] Z[z_after_toolchange] F12000\n{endif}\nM621 S[next_extruder]A
; circle_compensation_manual_offset = 0
; circle_compensation_speed = 200
; close_additional_fan_first_x_layers = 1
; close_fan_the_first_x_layers = 1
; compatible_printers_condition = 
; complete_print_exhaust_fan_speed = 70
; cool_plate_temp = 35
; cool_plate_temp_initial_layer = 35
; cooling_filter_enabled = 0
; cooling_perimeter_transition_distance = 10
; cooling_slowdown_logic = uniform_cooling
; counter_coef_1 = 0
; counter_coef_2 = 0.008
; counter_coef_3 = -0.041
; counter_limit_max = 0.033
; counter_limit_min = -0.035
; counterbore_hole_bridging = none
; curr_bed_type = Cool Plate
; default_acceleration = 6000
; default_ams_type = -1
; default_filament_colour = ""
; default_filament_profile = "Bambu PLA Basic @BBL A1M"
; default_jerk = 0
; default_nozzle_volume_type = Standard
; default_print_profile = 0.20mm Standard @BBL A1M
; deretraction_speed = 30
; detect_floating_vertical_shell = 1
; detect_narrow_internal_solid_infill = 1
; detect_overhang_wall = 1
; detect_thin_wall = 0
; diameter_limit = 50
; different_settings_to_system = ;;
; draft_shield = disabled
; during_print_exhaust_fan_speed = 70
; elefant_foot_compensation = 0
; embedding_wall_into_infill = 0
; enable_arc_fitting = 1
; enable_circle_compensation = 0
; enable_filament_dynamic_map = 0
; enable_height_slowdown = 0
; enable_long_retraction_when_cut = 2
; enable_mixed_color_sublayer = 0
; enable_order_independent_overlap_carving = 0
; enable_overhang_bridge_fan = 1
; enable_overhang_speed = 1
; enable_pre_heating = 0
; enable_pressure_advance = 0
; enable_prime_tower = 1
; enable_support = 0
; enable_support_ironing = 0
; enable_tower_interface_features = 0
; enable_wrapping_detection = 0
; enforce_support_layers = 0
; eng_plate_temp = 0
; eng_plate_temp_initial_layer = 0
; ensure_vertical_shell_thickness = enabled
; exclude_object = 1
; extruder_ams_count = 
; extruder_clearance_dist_to_rod = 56.5
; extruder_clearance_height_to_lid = 180
; extruder_clearance_height_to_rod = 25
; extruder_clearance_max_radius = 73
; extruder_colour = #018001
; extruder_max_nozzle_count = 1
; extruder_nozzle_stats = 
; extruder_offset = 0x0
; extruder_printable_area = 
; extruder_type = Direct Drive
; extruder_variant_list = "Direct Drive Standard"
; fan_cooling_layer_time = 80
; fan_direction = undefine
; fan_max_speed = 80
; fan_min_speed = 60
; farthest_point_timelapse = 0
; filament_adaptive_volumetric_speed = 0
; filament_adhesiveness_category = 100
; filament_bridge_speed = 25
; filament_change_length = 10
; filament_change_length_nc = 10
; filament_colour = #00AE42
; filament_cooling_before_tower = 0
; filament_cost = 19.99
; filament_density = 1.27
; filament_dev_ams_drying_ams_limitations = 1
; filament_dev_ams_drying_heat_distortion_temperature = 45
; filament_dev_ams_drying_temperature = 45
; filament_dev_ams_drying_time = 12
; filament_dev_chamber_drying_bed_temperature = 70
; filament_dev_chamber_drying_time = 12
; filament_dev_drying_cooling_temperature = 45
; filament_dev_drying_softening_temperature = 50
; filament_diameter = 1.75
; filament_enable_overhang_speed = 1
; filament_end_gcode = "; filament end gcode \n\n"
; filament_extruder_compatibility = 0
; filament_extruder_variant = "Direct Drive Standard"
; filament_flow_ratio = 0.98
; filament_flush_temp = 0
; filament_flush_temp_fast = 0
; filament_flush_volumetric_speed = 0
; filament_ids = GFA06
; filament_is_mixed = 0
; filament_is_support = 0
; filament_map = 1
; filament_map_2 = 0
; filament_map_mode = Auto For Flush
; filament_max_volumetric_speed = 12
; filament_metal_stickiness = None
; filament_minimal_purge_on_wipe_tower = 15
; filament_mixed_components = ""
; filament_mixed_gradient = 0
; filament_mixed_gradient_curve = ""
; filament_mixed_gradient_per_part = 0
; filament_mixed_gradient_range = ""
; filament_mixed_sublayer_ratios = ""
; filament_notes = 
; filament_nozzle_map = 0
; filament_overhang_1_4_speed = 0
; filament_overhang_2_4_speed = 50
; filament_overhang_3_4_speed = 30
; filament_overhang_4_4_speed = 10
; filament_overhang_totally_speed = 10
; filament_pre_cooling_temperature = 0
; filament_pre_cooling_temperature_nc = 0
; filament_preheat_temperature_delta = 0
; filament_prime_volume = 45
; filament_prime_volume_nc = 60
; filament_printable = 3
; filament_ramming_travel_time = 0
; filament_ramming_travel_time_nc = 0
; filament_ramming_volumetric_speed = -1
; filament_ramming_volumetric_speed_nc = -1
; filament_retract_length_nc = 14
; filament_scarf_gap = 15%
; filament_scarf_height = 5%
; filament_scarf_length = 10
; filament_scarf_seam_type = none
; filament_self_index = 1
; filament_settings_id = "Bambu PLA Silk+ @BBL A1M"
; filament_shrink = 100%
; filament_soluble = 0
; filament_start_gcode = "; filament start gcode\n{if  (bed_temperature[current_extruder] >55)||(bed_temperature_initial_layer[current_extruder] >55)}M106 P3 S200\n{elsif(bed_temperature[current_extruder] >50)||(bed_temperature_initial_layer[current_extruder] >50)}M106 P3 S150\n{elsif(bed_temperature[current_extruder] >45)||(bed_temperature_initial_layer[current_extruder] >45)}M106 P3 S50\n{endif}\n\n{if activate_air_filtration[current_extruder] && support_air_filtration}\nM106 P3 S{during_print_exhaust_fan_speed_num[current_extruder]} \n{endif}"
; filament_tower_interface_pre_extrusion_dist = 10
; filament_tower_interface_pre_extrusion_length = 0
; filament_tower_interface_print_temp = -1
; filament_tower_interface_purge_volume = 20
; filament_tower_ironing_area = 4
; filament_type = PLA
; filament_velocity_adaptation_factor = 1
; filament_vendor = "Bambu Lab"
; filament_volume_map = 0
; filename_format = {input_filename_base}_{filament_type[0]}_{print_time}.gcode
; fill_multiline = 1
; filter_out_gap_fill = 0
; first_layer_print_sequence = 0
; first_x_layer_fan_speed = 0
; first_x_layer_part_fan_speed = 0
; flush_into_infill = 0
; flush_into_objects = 0
; flush_into_support = 1
; flush_multiplier = 1
; flush_multiplier_fast = 1.2
; flush_volumes_matrix = 0,280,280,280,280,0,280,280,280,280,0,280,280,280,280,0
; flush_volumes_vector = 140,140,140,140,140,140,140,140
; full_fan_speed_layer = 0
; fuzzy_skin = none
; fuzzy_skin_first_layer = 0
; fuzzy_skin_mode = displacement
; fuzzy_skin_noise_type = classic
; fuzzy_skin_octaves = 4
; fuzzy_skin_persistence = 0.5
; fuzzy_skin_point_distance = 0.8
; fuzzy_skin_scale = 1
; fuzzy_skin_thickness = 0.3
; gap_infill_speed = 250
; gcode_add_line_number = 0
; gcode_flavor = marlin
; grab_length = 17.4
; group_algo_with_time = 0
; has_filament_switcher = 0
; has_scarf_joint_seam = 0
; head_wrap_detect_zone = 156x152,180x152,180x180,156x180
; hole_coef_1 = 0
; hole_coef_2 = -0.008
; hole_coef_3 = 0.23415
; hole_limit_max = 0.22
; hole_limit_min = 0.088
; hot_plate_temp = 60
; hot_plate_temp_initial_layer = 60
; hotend_cooling_rate = 2
; hotend_heating_rate = 2
; impact_strength_z = 8.5
; independent_support_layer_height = 1
; infill_combination = 0
; infill_direction = 45
; infill_instead_top_bottom_surfaces = 0
; infill_jerk = 9
; infill_lock_depth = 1
; infill_rotate_step = 0
; infill_shift_step = 0.4
; infill_wall_overlap = 15%
; inherits_group = ;;
; initial_layer_acceleration = 500
; initial_layer_flow_ratio = 1
; initial_layer_infill_speed = 105
; initial_layer_jerk = 9
; initial_layer_line_width = 0.5
; initial_layer_print_height = 0.2
; initial_layer_speed = 50
; initial_layer_travel_acceleration = 6000
; inner_wall_acceleration = 0
; inner_wall_jerk = 9
; inner_wall_line_width = 0.45
; inner_wall_speed = 300
; interface_shells = 0
; interlocking_beam = 0
; interlocking_beam_layer_count = 2
; interlocking_beam_width = 0.8
; interlocking_boundary_avoidance = 2
; interlocking_depth = 2
; interlocking_orientation = 22.5
; internal_bridge_support_thickness = 0.8
; internal_solid_infill_line_width = 0.42
; internal_solid_infill_pattern = zig-zag
; internal_solid_infill_speed = 250
; ironing_direction = 45
; ironing_fan_speed = -1
; ironing_flow = 10%
; ironing_inset = 0.21
; ironing_pattern = zig-zag
; ironing_spacing = 0.15
; ironing_speed = 30
; ironing_type = no ironing
; is_infill_first = 0
; layer_change_gcode = ; layer num/total_layer_count: {layer_num+1}/[total_layer_count]\n; update layer progress\nM73 L{layer_num+1}\nM991 S0 P{layer_num} ;notify layer change
; layer_height = 0.2
; line_width = 0.42
; locked_skeleton_infill_pattern = zigzag
; locked_skin_infill_pattern = crosszag
; long_retractions_when_cut = 0
; long_retractions_when_ec = 0
; machine_bed_mass_Y = 0
; machine_end_gcode = ;===== date: 20230428 =====================\nM400 ; wait for buffer to clear\nG92 E0 ; zero the extruder\nG1 E-0.8 F1800 ; retract\nG1 Z{max_layer_z + 0.5} F900 ; lower z a little\nG1 X65 Y245 F12000 ; move to safe pos \nG1 Y265 F3000\n\nG1 X65 Y245 F12000\nG1 Y265 F3000\nM140 S0 ; turn off bed\nM106 S0 ; turn off fan\nM106 P2 S0 ; turn off remote part cooling fan\nM106 P3 S0 ; turn off chamber cooling fan\n\nG1 X100 F12000 ; wipe\n; pull back filament to AMS\nM620 S255\nG1 X20 Y50 F12000\nG1 Y-3\nT255\nG1 X65 F12000\nG1 Y265\nG1 X100 F12000 ; wipe\nM621 S255\nM104 S0 ; turn off hotend\n\nM622.1 S1 ; for prev firmware, default turned on\nM1002 judge_flag timelapse_record_flag\nM622 J1\n    M400 ; wait all motion done\n    M991 S0 P-1 ;end smooth timelapse at safe pos\n    M400 S3 ;wait for last picture to be taken\nM623; end of \"timelapse_record_flag\"\n\nM400 ; wait all motion done\nM17 S\nM17 Z0.4 ; lower z motor current to reduce impact if there is something in the bottom\n{if (max_layer_z + 100.0) < 250}\n    G1 Z{max_layer_z + 100.0} F600\n    G1 Z{max_layer_z +98.0}\n{else}\n    G1 Z250 F600\n    G1 Z248\n{endif}\nM400 P100\nM17 R ; restore z current\n\nG90\nG1 X128 Y250 F3600\n\nM220 S100  ; Reset feedrate magnitude\nM201.2 K1.0 ; Reset acc magnitude\nM73.2   R1.0 ;Reset left time magnitude\nM1002 set_gcode_claim_speed_level : 0\n\nM17 X0.8 Y0.8 Z0.5 ; lower motor current to 45% power\n
; machine_hotend_change_time = 0
; machine_load_filament_time = 28
; machine_max_acceleration_e = 5000,5000
; machine_max_acceleration_extruding = 20000,20000
; machine_max_acceleration_retracting = 5000,5000
; machine_max_acceleration_travel = 6000,6000
; machine_max_acceleration_x = 6000,6000
; machine_max_acceleration_y = 6000,6000
; machine_max_acceleration_z = 1500,1500
; machine_max_force_Y = 0
; machine_max_jerk_e = 3,3
; machine_max_jerk_x = 9,9
; machine_max_jerk_y = 9,9
; machine_max_jerk_z = 5,5
; machine_max_printed_mass = 0
; machine_max_speed_e = 30,30
; machine_max_speed_x = 500,200
; machine_max_speed_y = 500,200
; machine_max_speed_z = 30,30
; machine_min_extruding_rate = 0,0
; machine_min_travel_rate = 0,0
; machine_pause_gcode = M400 U1
; machine_prepare_compensation_time = 260
; machine_start_gcode = G0 Z20 F9000\nG92 E0; G1 E-10 F1200\nG28\nM970 Q1 A10 B10 C130 K0\nM970 Q1 A10 B131 C250 K1\nM974 Q1 S1 P0\nM970 Q0 A10 B10 C130 H20 K0\nM970 Q0 A10 B131 C250 K1\nM974 Q0 S1 P0\nM220 S100 ;Reset Feedrate\nM221 S100 ;Reset Flowrate\nG29 ;Home\nG90;\nG92 E0 ;Reset Extruder \nG1 Z2.0 F3000 ;Move Z Axis up \nG1 X10.1 Y20 Z0.28 F5000.0 ;Move to start position\nM109 S205;\nG1 X10.1 Y200.0 Z0.28 F1500.0 E15 ;Draw the first line\nG1 X10.4 Y200.0 Z0.28 F5000.0 ;Move to side a little\nG1 X10.4 Y20 Z0.28 F1500.0 E30 ;Draw the second line\nG92 E0 ;Reset Extruder \nG1 X110 Y110 Z2.0 F3000 ;Move Z Axis up
; machine_switch_extruder_time = 0
; machine_unload_filament_time = 34
; master_extruder_id = 1
; max_bridge_length = 0
; max_layer_height = 0.28
; max_travel_detour_distance = 0
; min_bead_width = 85%
; min_feature_size = 25%
; min_layer_height = 0.08
; minimum_sparse_infill_area = 15
; mmu_segmented_region_interlocking_depth = 0
; mmu_segmented_region_max_width = 0
; monotonic_travel_into_wall = 0%
; no_slow_down_for_cooling_on_outwalls = 0
; nozzle_diameter = 0.4
; nozzle_flush_dataset = 0
; nozzle_height = 4.76
; nozzle_temperature = 230
; nozzle_temperature_initial_layer = 230
; nozzle_temperature_range_high = 240
; nozzle_temperature_range_low = 190
; nozzle_type = stainless_steel
; nozzle_volume = 92
; nozzle_volume_type = Standard
; only_one_wall_first_layer = 0
; ooze_prevention = 0
; other_layers_print_sequence = 0
; other_layers_print_sequence_nums = 0
; outer_wall_acceleration = 5000
; outer_wall_jerk = 9
; outer_wall_line_width = 0.42
; outer_wall_speed = 200
; overhang_1_4_speed = 0
; overhang_2_4_speed = 50
; overhang_3_4_speed = 30
; overhang_4_4_speed = 10
; overhang_fan_speed = 100
; overhang_fan_threshold = 50%
; overhang_threshold_participating_cooling = 95%
; overhang_totally_speed = 10
; override_filament_scarf_seam_setting = 0
; override_process_overhang_speed = 0
; physical_extruder_map = 0
; post_process = 
; pre_start_fan_time = 0
; precise_outer_wall = 0
; precise_z_height = 0
; pressure_advance = 0.02
; prime_tower_brim_width = 3
; prime_tower_enable_framework = 0
; prime_tower_extra_rib_length = 0
; prime_tower_fillet_wall = 1
; prime_tower_flat_ironing = 0
; prime_tower_infill_gap = 150%
; prime_tower_lift_height = -1
; prime_tower_lift_speed = 90
; prime_tower_max_speed = 90
; prime_tower_rib_wall = 1
; prime_tower_rib_width = 8
; prime_tower_skip_points = 1
; prime_tower_width = 35
; prime_volume_mode = Default
; print_compatible_printers = "Bambu Lab A1 mini 0.4 nozzle"
; print_extruder_id = 1
; print_extruder_variant = "Direct Drive Standard"
; print_flow_ratio = 1
; print_in_clockwise = 0
; print_sequence = by layer
; print_settings_id = nova3D R-3 effective process override
; printable_area = 0x0,180x0,180x180,0x180
; printable_height = 180
; printer_extruder_id = 1
; printer_extruder_variant = "Direct Drive Standard"
; printer_model = Bambu Lab A1 mini
; printer_notes = 
; printer_settings_id = Bambu Lab A1 mini 0.4 nozzle
; printer_structure = i3
; printer_technology = FFF
; printer_variant = 0.4
; printing_by_object_gcode = 
; process_notes = 
; raft_contact_distance = 0.1
; raft_expansion = 1.5
; raft_first_layer_density = 90%
; raft_first_layer_expansion = -1
; raft_layers = 0
; reduce_crossing_wall = 0
; reduce_fan_stop_start_freq = 1
; reduce_infill_retraction_mode = Auto
; required_nozzle_HRC = 3
; resolution = 0.012
; retract_before_wipe = 0%
; retract_length_toolchange = 2
; retract_lift_above = 0
; retract_lift_below = 179
; retract_restart_extra = 0
; retract_restart_extra_toolchange = 0
; retract_when_changing_layer = 1
; retraction_distances_when_cut = 18
; retraction_distances_when_ec = 0
; retraction_length = 0.8
; retraction_minimum_travel = 1
; retraction_speed = 30
; role_base_wipe_speed = 1
; scan_first_layer = 0
; scarf_angle_threshold = 155
; seam_gap = 15%
; seam_placement_away_from_overhangs = 0
; seam_position = aligned
; seam_slope_conditional = 1
; seam_slope_entire_loop = 0
; seam_slope_gap = 0
; seam_slope_inner_walls = 1
; seam_slope_min_length = 10
; seam_slope_start_height = 10%
; seam_slope_steps = 10
; seam_slope_type = none
; silent_mode = 0
; single_extruder_multi_material = 1
; skeleton_infill_density = 15%
; skeleton_infill_line_width = 0.45
; skin_infill_density = 15%
; skin_infill_depth = 2
; skin_infill_line_width = 0.45
; skirt_distance = 2
; skirt_height = 1
; skirt_loops = 0
; skirt_per_object = 1
; slice_closing_radius = 0.049
; slicing_mode = regular
; slow_down_for_layer_cooling = 1
; slow_down_layer_time = 8
; slow_down_min_speed = 20
; slowdown_end_acc = 100000
; slowdown_end_height = 400
; slowdown_end_speed = 1000
; slowdown_start_acc = 100000
; slowdown_start_height = 0
; slowdown_start_speed = 1000
; small_perimeter_speed = 50%
; small_perimeter_threshold = 0
; smooth_coefficient = 80
; smooth_speed_discontinuity_area = 1
; solid_infill_filament = 0
; sparse_infill_acceleration = 100%
; sparse_infill_anchor = 400%
; sparse_infill_anchor_max = 20
; sparse_infill_density = 15%
; sparse_infill_filament = 0
; sparse_infill_lattice_angle_1 = -45
; sparse_infill_lattice_angle_2 = 45
; sparse_infill_line_width = 0.45
; sparse_infill_pattern = grid
; sparse_infill_speed = 270
; spiral_mode = 0
; spiral_mode_max_xy_smoothing = 200%
; spiral_mode_smooth = 0
; standby_temperature_delta = -5
; start_end_points = 30x-3,54x245
; supertack_plate_temp = 35
; supertack_plate_temp_initial_layer = 35
; support_air_filtration = 0
; support_angle = 0
; support_base_pattern = default
; support_base_pattern_spacing = 2.5
; support_bottom_interface_spacing = 0.5
; support_bottom_z_distance = 0.2
; support_chamber_temp_control = 0
; support_cooling_filter = 0
; support_critical_regions_only = 0
; support_expansion = 0
; support_fast_purge_mode = 0
; support_filament = 0
; support_interface_bottom_layers = 2
; support_interface_filament = 0
; support_interface_loop_pattern = 0
; support_interface_not_for_body = 1
; support_interface_pattern = auto
; support_interface_spacing = 0.5
; support_interface_speed = 80
; support_interface_top_layers = 2
; support_ironing_direction = 0
; support_ironing_flow = 10%
; support_ironing_inset = 0
; support_ironing_pattern = zig-zag
; support_ironing_spacing = 0.15
; support_ironing_speed = 30
; support_line_width = 0.42
; support_object_first_layer_gap = 0.2
; support_object_skip_flush = 0
; support_object_xy_distance = 0.35
; support_on_build_plate_only = 0
; support_remove_small_overhang = 1
; support_speed = 150
; support_style = default
; support_threshold_angle = 30
; support_top_z_distance = 0.2
; support_type = tree(auto)
; symmetric_infill_y_axis = 0
; temperature_vitrification = 45
; template_custom_gcode = 
; textured_plate_temp = 60
; textured_plate_temp_initial_layer = 60
; thick_bridges = 0
; thumbnail_size = 50x50
; time_lapse_gcode = ;========Date 20250206========\nM622.1 S1 ; for prev firmware, default turned on\nM1002 judge_flag timelapse_record_flag\nM622 J1\n{if timelapse_type == 0} ; timelapse without wipe tower\nM971 S11 C10 O0\n{elsif timelapse_type == 1} ; timelapse with wipe tower\nG92 E0\nG1 X65 Y245 F20000 ; move to safe pos\nG17\nG2 Z{layer_z} I0.86 J0.86 P1 F20000\nG1 Y265 F3000\nM400 P300\nM971 S11 C10 O0\nG92 E0\nG1 X100 F5000\nG1 Y255 F20000\n{endif}\nM623\n
; timelapse_type = 0
; top_area_threshold = 200%
; top_color_penetration_layers = 5
; top_one_wall_type = all top
; top_shell_layers = 5
; top_shell_thickness = 1
; top_solid_infill_flow_ratio = 1
; top_surface_acceleration = 2000
; top_surface_density = 100%
; top_surface_jerk = 9
; top_surface_line_width = 0.42
; top_surface_pattern = monotonicline
; top_surface_speed = 200
; top_z_overrides_xy_distance = 0
; travel_acceleration = 10000
; travel_jerk = 9
; travel_short_distance_acceleration = 250
; travel_speed = 700
; travel_speed_z = 0
; tree_support_branch_angle = 45
; tree_support_branch_diameter = 2
; tree_support_branch_diameter_angle = 5
; tree_support_branch_distance = 5
; tree_support_wall_count = -1
; upward_compatible_machine = "Bambu Lab P1S 0.4 nozzle";"Bambu Lab P1P 0.4 nozzle";"Bambu Lab X1 0.4 nozzle";"Bambu Lab X1 Carbon 0.4 nozzle";"Bambu Lab X1E 0.4 nozzle";"Bambu Lab A1 0.4 nozzle";"Bambu Lab H2D 0.4 nozzle";"Bambu Lab H2D Pro 0.4 nozzle";"Bambu Lab H2S 0.4 nozzle";"Bambu Lab P2S 0.4 nozzle";"Bambu Lab H2C 0.4 nozzle";"Bambu Lab X2D 0.4 nozzle";"Bambu Lab A2L 0.4 nozzle"
; use_firmware_retraction = 0
; use_relative_e_distances = 1
; vertical_shell_speed = 80%
; volumetric_speed_coefficients = "0 0 0 0 0 0"
; wall_distribution_count = 1
; wall_filament = 0
; wall_generator = classic
; wall_loops = 3
; wall_sequence = inner wall/outer wall
; wall_transition_angle = 10
; wall_transition_filter_deviation = 25%
; wall_transition_length = 100%
; wipe = 1
; wipe_distance = 2
; wipe_speed = 80%
; wipe_tower_no_sparse_layers = 0
; wipe_tower_rotation_angle = 0
; wipe_tower_x = 15
; wipe_tower_y = 220
; wrapping_detection_gcode = 
; wrapping_detection_layers = 20
; wrapping_exclude_area = 
; xy_contour_compensation = 0
; xy_hole_compensation = 0
; z_direction_outwall_speed_continuous = 0
; z_hop = 0.4
; z_hop_types = Auto Lift
; CONFIG_BLOCK_END

; EXECUTABLE_BLOCK_START
M73 P0 R35
M201 X6000 Y6000 Z1500 E5000
M203 X500 Y500 Z30 E30
M204 P20000 R5000 T20000
M205 X9.00 Y9.00 Z5.00 E3.00
M106 S0
M190 S35 ; set bed temperature and wait for it to be reached
; FEATURE: Custom
G0 Z20 F9000
G92 E0; G1 E-10 F1200
G28
M970 Q1 A10 B10 C130 K0
M970 Q1 A10 B131 C250 K1
M974 Q1 S1 P0
M970 Q0 A10 B10 C130 H20 K0
M970 Q0 A10 B131 C250 K1
M974 Q0 S1 P0
M220 S100 ;Reset Feedrate
M221 S100 ;Reset Flowrate
G29 ;Home
G90;
G92 E0 ;Reset Extruder 
G1 Z2.0 F3000 ;Move Z Axis up 
G1 X10.1 Y20 Z0.28 F5000.0 ;Move to start position
M109 S205;
G1 X10.1 Y200.0 Z0.28 F1500.0 E15 ;Draw the first line
G1 X10.4 Y200.0 Z0.28 F5000.0 ;Move to side a little
G1 X10.4 Y20 Z0.28 F1500.0 E30 ;Draw the second line
G92 E0 ;Reset Extruder 
G1 X110 Y110 Z2.0 F3000 ;Move Z Axis up
; MACHINE_START_GCODE_END
; filament start gcode


;VT0 H-1
G90
G21
M83 ; use relative distances for extrusion
M981 S1 P20000 ;open spaghetti detector
; CHANGE_LAYER
; Z_HEIGHT: 0.2
; LAYER_HEIGHT: 0.2
G1 E-.8 F1800
; layer num/total_layer_count: 1/200
; update layer progress
M73 L1
M991 S0 P0 ;notify layer change
M106 S0
; OBJECT_ID: 15
G1 X108.836 Y108.836 F42000
M204 S6000
G1 Z.4
G1 Z.2
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.5
G1 F3000
M204 S500
G1 X71.164 Y108.836 E1.40313
G1 X71.164 Y71.164 E1.40313
G1 X108.836 Y71.164 E1.40313
G1 X108.836 Y108.776 E1.40089
M204 S6000
G1 X109.293 Y109.293 F42000
G1 F3000
M204 S500
M73 P1 R35
G1 X70.707 Y109.293 E1.43718
G1 X70.707 Y70.707 E1.43718
G1 X109.293 Y70.707 E1.43718
G1 X109.293 Y109.233 E1.43494
M204 S6000
G1 X109.75 Y109.75 F42000
; FEATURE: Outer wall
G1 F3000
M204 S500
G1 X70.25 Y109.75 E1.47123
G1 X70.25 Y70.25 E1.47123
G1 X109.75 Y70.25 E1.47123
G1 X109.75 Y109.69 E1.46899
; WIPE_START
G1 X107.75 Y109.693 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S6000
G17
G3 Z.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.653 Y72.276
G1 Z.2
G1 E.8 F1800
; FEATURE: Bottom surface
; LINE_WIDTH: 0.50225
G1 F6300
M204 S500
G1 X107.93 Y71.553 E.03827
G1 X107.28 Y71.553 E.02431
G1 X108.447 Y72.72 E.06177
G1 X108.447 Y73.369 E.02431
G1 X106.631 Y71.553 E.09616
G1 X105.981 Y71.553 E.02431
G1 X108.447 Y74.019 E.13054
G1 X108.447 Y74.668 E.02431
G1 X105.332 Y71.553 E.16493
G1 X104.682 Y71.553 E.02431
G1 X108.447 Y75.318 E.19931
G1 X108.447 Y75.968 E.02431
G1 X104.032 Y71.553 E.2337
G1 X103.383 Y71.553 E.02431
G1 X108.447 Y76.617 E.26808
G1 X108.447 Y77.267 E.02431
G1 X102.733 Y71.553 E.30247
G1 X102.084 Y71.553 E.02431
G1 X108.447 Y77.916 E.33685
G1 X108.447 Y78.566 E.02431
G1 X101.434 Y71.553 E.37124
G1 X100.784 Y71.553 E.02431
G1 X108.447 Y79.216 E.40562
G1 X108.447 Y79.865 E.02431
G1 X100.135 Y71.553 E.44001
G1 X99.485 Y71.553 E.02431
G1 X108.447 Y80.515 E.47439
G1 X108.447 Y81.164 E.02431
G1 X98.836 Y71.553 E.50878
G1 X98.186 Y71.553 E.02431
G1 X108.447 Y81.814 E.54316
G1 X108.447 Y82.463 E.02431
G1 X97.537 Y71.553 E.57755
G1 X96.887 Y71.553 E.02431
G1 X108.447 Y83.113 E.61193
G1 X108.447 Y83.763 E.02431
G1 X96.237 Y71.553 E.64632
G1 X95.588 Y71.553 E.02431
G1 X108.447 Y84.412 E.6807
G1 X108.447 Y85.062 E.02431
G1 X94.938 Y71.553 E.71509
G1 X94.289 Y71.553 E.02431
G1 X108.447 Y85.711 E.74947
G1 X108.447 Y86.361 E.02431
G1 X93.639 Y71.553 E.78386
G1 X92.989 Y71.553 E.02431
G1 X108.447 Y87.011 E.81824
G1 X108.447 Y87.66 E.02431
G1 X92.34 Y71.553 E.85263
G1 X91.69 Y71.553 E.02431
G1 X108.447 Y88.31 E.88701
G1 X108.447 Y88.959 E.02431
G1 X91.041 Y71.553 E.9214
G1 X90.391 Y71.553 E.02431
G1 X108.447 Y89.609 E.95578
G1 X108.447 Y90.259 E.02431
G1 X89.741 Y71.553 E.99017
G1 X89.092 Y71.553 E.02431
G1 X108.447 Y90.908 E1.02455
G1 X108.447 Y91.558 E.02431
G1 X88.442 Y71.553 E1.05894
G1 X87.793 Y71.553 E.02431
G1 X108.447 Y92.207 E1.09332
G1 X108.447 Y92.857 E.02431
G1 X87.143 Y71.553 E1.12771
G1 X86.494 Y71.553 E.02431
G1 X108.447 Y93.507 E1.16209
G1 X108.447 Y94.156 E.02431
G1 X85.844 Y71.553 E1.19648
G1 X85.194 Y71.553 E.02431
G1 X108.447 Y94.806 E1.23086
G1 X108.447 Y95.455 E.02431
G1 X84.545 Y71.553 E1.26525
G1 X83.895 Y71.553 E.02431
G1 X108.447 Y96.105 E1.29963
G1 X108.447 Y96.754 E.02431
G1 X83.246 Y71.553 E1.33402
M73 P2 R35
G1 X82.596 Y71.553 E.02431
G1 X108.447 Y97.404 E1.3684
G1 X108.447 Y98.054 E.02431
G1 X81.946 Y71.553 E1.40279
G1 X81.297 Y71.553 E.02431
G1 X108.447 Y98.703 E1.43717
G1 X108.447 Y99.353 E.02431
G1 X80.647 Y71.553 E1.47156
G1 X79.998 Y71.553 E.02431
G1 X108.447 Y100.002 E1.50594
G1 X108.447 Y100.652 E.02431
G1 X79.348 Y71.553 E1.54033
G1 X78.698 Y71.553 E.02431
G1 X108.447 Y101.302 E1.57471
G1 X108.447 Y101.951 E.02431
G1 X78.049 Y71.553 E1.6091
G1 X77.399 Y71.553 E.02431
G1 X108.447 Y102.601 E1.64348
G1 X108.447 Y103.25 E.02431
G1 X76.75 Y71.553 E1.67787
G1 X76.1 Y71.553 E.02431
G1 X108.447 Y103.9 E1.71225
M73 P2 R34
G1 X108.447 Y104.55 E.02431
G1 X75.45 Y71.553 E1.74664
G1 X74.801 Y71.553 E.02431
G1 X108.447 Y105.199 E1.78102
G1 X108.447 Y105.849 E.02431
G1 X74.151 Y71.553 E1.81541
G1 X73.502 Y71.553 E.02431
G1 X108.447 Y106.498 E1.84979
G1 X108.447 Y107.148 E.02431
G1 X72.852 Y71.553 E1.88418
G1 X72.203 Y71.553 E.02431
G1 X108.447 Y107.798 E1.91856
G1 X108.447 Y108.447 E.02431
G1 X71.553 Y71.553 E1.95295
G1 X71.553 Y72.202 E.0243
G1 X107.798 Y108.447 E1.91859
G1 X107.148 Y108.447 E.02431
G1 X71.553 Y72.852 E1.88421
G1 X71.553 Y73.501 E.02431
G1 X106.499 Y108.447 E1.84982
G1 X105.849 Y108.447 E.02431
G1 X71.553 Y74.151 E1.81544
G1 X71.553 Y74.8 E.02431
G1 X105.2 Y108.447 E1.78105
G1 X104.55 Y108.447 E.02431
G1 X71.553 Y75.45 E1.74667
G1 X71.553 Y76.1 E.02431
G1 X103.9 Y108.447 E1.71228
G1 X103.251 Y108.447 E.02431
G1 X71.553 Y76.749 E1.6779
G1 X71.553 Y77.399 E.02431
G1 X102.601 Y108.447 E1.64351
G1 X101.952 Y108.447 E.02431
G1 X71.553 Y78.048 E1.60913
G1 X71.553 Y78.698 E.02431
G1 X101.302 Y108.447 E1.57474
G1 X100.653 Y108.447 E.02431
G1 X71.553 Y79.347 E1.54036
G1 X71.553 Y79.997 E.02431
G1 X100.003 Y108.447 E1.50597
G1 X99.353 Y108.447 E.02431
G1 X71.553 Y80.647 E1.47159
G1 X71.553 Y81.296 E.02431
G1 X98.704 Y108.447 E1.4372
M73 P3 R34
G1 X98.054 Y108.447 E.02431
G1 X71.553 Y81.946 E1.40282
G1 X71.553 Y82.595 E.02431
G1 X97.405 Y108.447 E1.36843
G1 X96.755 Y108.447 E.02431
G1 X71.553 Y83.245 E1.33404
G1 X71.553 Y83.895 E.02431
G1 X96.105 Y108.447 E1.29966
G1 X95.456 Y108.447 E.02431
G1 X71.553 Y84.544 E1.26527
G1 X71.553 Y85.194 E.02431
G1 X94.806 Y108.447 E1.23089
G1 X94.157 Y108.447 E.02431
G1 X71.553 Y85.843 E1.1965
G1 X71.553 Y86.493 E.02431
G1 X93.507 Y108.447 E1.16212
G1 X92.857 Y108.447 E.02431
G1 X71.553 Y87.143 E1.12773
G1 X71.553 Y87.792 E.02431
G1 X92.208 Y108.447 E1.09335
G1 X91.558 Y108.447 E.02431
G1 X71.553 Y88.442 E1.05896
G1 X71.553 Y89.091 E.02431
G1 X90.909 Y108.447 E1.02458
G1 X90.259 Y108.447 E.02431
G1 X71.553 Y89.741 E.99019
G1 X71.553 Y90.391 E.02431
G1 X89.609 Y108.447 E.95581
G1 X88.96 Y108.447 E.02431
G1 X71.553 Y91.04 E.92142
G1 X71.553 Y91.69 E.02431
G1 X88.31 Y108.447 E.88704
G1 X87.661 Y108.447 E.02431
G1 X71.553 Y92.339 E.85265
G1 X71.553 Y92.989 E.02431
G1 X87.011 Y108.447 E.81827
G1 X86.362 Y108.447 E.02431
G1 X71.553 Y93.638 E.78388
G1 X71.553 Y94.288 E.02431
G1 X85.712 Y108.447 E.7495
G1 X85.062 Y108.447 E.02431
G1 X71.553 Y94.938 E.71511
G1 X71.553 Y95.587 E.02431
G1 X84.413 Y108.447 E.68073
G1 X83.763 Y108.447 E.02431
G1 X71.553 Y96.237 E.64634
G1 X71.553 Y96.886 E.02431
G1 X83.114 Y108.447 E.61196
G1 X82.464 Y108.447 E.02431
G1 X71.553 Y97.536 E.57757
G1 X71.553 Y98.186 E.02431
G1 X81.814 Y108.447 E.54319
G1 X81.165 Y108.447 E.02431
G1 X71.553 Y98.835 E.5088
G1 X71.553 Y99.485 E.02431
G1 X80.515 Y108.447 E.47442
G1 X79.866 Y108.447 E.02431
G1 X71.553 Y100.134 E.44003
G1 X71.553 Y100.784 E.02431
G1 X79.216 Y108.447 E.40565
G1 X78.566 Y108.447 E.02431
G1 X71.553 Y101.434 E.37126
G1 X71.553 Y102.083 E.02431
G1 X77.917 Y108.447 E.33688
G1 X77.267 Y108.447 E.02431
G1 X71.553 Y102.733 E.30249
G1 X71.553 Y103.382 E.02431
G1 X76.618 Y108.447 E.26811
G1 X75.968 Y108.447 E.02431
G1 X71.553 Y104.032 E.23372
G1 X71.553 Y104.682 E.02431
G1 X75.318 Y108.447 E.19934
G1 X74.669 Y108.447 E.02431
G1 X71.553 Y105.331 E.16495
G1 X71.553 Y105.981 E.02431
G1 X74.019 Y108.447 E.13057
G1 X73.37 Y108.447 E.02431
G1 X71.553 Y106.63 E.09618
G1 X71.553 Y107.28 E.02431
G1 X72.72 Y108.447 E.0618
G1 X72.071 Y108.447 E.02431
G1 X71.347 Y107.724 E.0383
; CHANGE_LAYER
; Z_HEIGHT: 0.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F6300
G1 X72.071 Y108.447 E-.38885
G1 X72.72 Y108.447 E-.24684
G1 X72.489 Y108.216 E-.12431
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 2/200
; update layer progress
M73 L2
M991 S0 P1 ;notify layer change
M106 S188.7
; open powerlost recovery
M1003 S1
; OBJECT_ID: 15
M204 S10000
G17
G3 Z.6 I-.026 J1.217 P1  F42000
G1 X108.991 Y108.991 Z.6
G1 Z.4
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F8843.478
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F8843.478
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F9547.055
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.063 Y108.827
G1 Z.4
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42096
G1 F9522.802
M204 S6000
G1 X108.658 Y108.233 E.02591
G1 X108.658 Y107.698 E.01647
G1 X107.698 Y108.658 E.0418
G1 X107.163 Y108.658 E.01647
G1 X108.658 Y107.163 E.0651
G1 X108.658 Y106.629 E.01647
G1 X106.629 Y108.658 E.08839
G1 X106.094 Y108.658 E.01647
G1 X108.658 Y106.094 E.11168
G1 X108.658 Y105.56 E.01647
G1 X105.56 Y108.658 E.13497
G1 X105.025 Y108.658 E.01647
G1 X108.658 Y105.025 E.15826
G1 X108.658 Y104.49 E.01647
G1 X104.49 Y108.658 E.18155
G1 X103.956 Y108.658 E.01647
G1 X108.658 Y103.956 E.20484
G1 X108.658 Y103.421 E.01647
G1 X103.421 Y108.658 E.22814
G1 X102.886 Y108.658 E.01647
G1 X108.658 Y102.886 E.25143
G1 X108.658 Y102.352 E.01647
G1 X102.352 Y108.658 E.27472
G1 X101.817 Y108.658 E.01647
G1 X108.658 Y101.817 E.29801
M73 P4 R34
G1 X108.658 Y101.282 E.01647
G1 X101.282 Y108.658 E.3213
G1 X100.748 Y108.658 E.01647
G1 X108.658 Y100.748 E.34459
G1 X108.658 Y100.213 E.01647
G1 X100.213 Y108.658 E.36788
G1 X99.679 Y108.658 E.01647
G1 X108.658 Y99.679 E.39118
G1 X108.658 Y99.144 E.01647
G1 X99.144 Y108.658 E.41447
G1 X98.609 Y108.658 E.01647
G1 X108.658 Y98.609 E.43776
G1 X108.658 Y98.075 E.01647
G1 X98.075 Y108.658 E.46105
G1 X97.54 Y108.658 E.01647
G1 X108.658 Y97.54 E.48434
G1 X108.658 Y97.005 E.01647
G1 X97.005 Y108.658 E.50763
G1 X96.471 Y108.658 E.01647
G1 X108.658 Y96.471 E.53092
G1 X108.658 Y95.936 E.01647
G1 X95.936 Y108.658 E.55422
G1 X95.402 Y108.658 E.01647
G1 X108.658 Y95.402 E.57751
G1 X108.658 Y94.867 E.01647
G1 X94.867 Y108.658 E.6008
G1 X94.332 Y108.658 E.01647
G1 X108.658 Y94.332 E.62409
G1 X108.658 Y93.798 E.01647
G1 X93.798 Y108.658 E.64738
G1 X93.263 Y108.658 E.01647
G1 X108.658 Y93.263 E.67067
G1 X108.658 Y92.728 E.01647
G1 X92.728 Y108.658 E.69396
G1 X92.194 Y108.658 E.01647
G1 X108.658 Y92.194 E.71726
G1 X108.658 Y91.659 E.01647
G1 X91.659 Y108.658 E.74055
G1 X91.125 Y108.658 E.01647
G1 X108.658 Y91.125 E.76384
G1 X108.658 Y90.59 E.01647
G1 X90.59 Y108.658 E.78713
G1 X90.055 Y108.658 E.01647
G1 X108.658 Y90.055 E.81042
G1 X108.658 Y89.521 E.01647
G1 X89.521 Y108.658 E.83371
G1 X88.986 Y108.658 E.01647
G1 X108.658 Y88.986 E.857
G1 X108.658 Y88.451 E.01647
G1 X88.451 Y108.658 E.8803
G1 X87.917 Y108.658 E.01647
G1 X108.658 Y87.917 E.90359
G1 X108.658 Y87.382 E.01647
G1 X87.382 Y108.658 E.92688
G1 X86.847 Y108.658 E.01647
G1 X108.658 Y86.847 E.95017
G1 X108.658 Y86.313 E.01647
G1 X86.313 Y108.658 E.97346
G1 X85.778 Y108.658 E.01647
G1 X108.658 Y85.778 E.99675
G1 X108.658 Y85.244 E.01647
G1 X85.244 Y108.658 E1.02004
G1 X84.709 Y108.658 E.01647
G1 X108.658 Y84.709 E1.04334
G1 X108.658 Y84.174 E.01647
G1 X84.174 Y108.658 E1.06663
G1 X83.64 Y108.658 E.01647
G1 X108.658 Y83.64 E1.08992
G1 X108.658 Y83.105 E.01647
G1 X83.105 Y108.658 E1.11321
G1 X82.57 Y108.658 E.01647
G1 X108.658 Y82.57 E1.1365
G1 X108.658 Y82.036 E.01647
G1 X82.036 Y108.658 E1.15979
G1 X81.501 Y108.658 E.01647
G1 X108.658 Y81.501 E1.18308
G1 X108.658 Y80.967 E.01647
G1 X80.967 Y108.658 E1.20638
G1 X80.432 Y108.658 E.01647
G1 X108.658 Y80.432 E1.22967
G1 X108.658 Y79.897 E.01647
G1 X79.897 Y108.658 E1.25296
G1 X79.363 Y108.658 E.01647
G1 X108.658 Y79.363 E1.27625
G1 X108.658 Y78.828 E.01647
G1 X78.828 Y108.658 E1.29954
G1 X78.293 Y108.658 E.01647
G1 X108.658 Y78.293 E1.32283
G1 X108.658 Y77.759 E.01647
G1 X77.759 Y108.658 E1.34612
G1 X77.224 Y108.658 E.01647
G1 X108.658 Y77.224 E1.36942
G1 X108.658 Y76.69 E.01647
G1 X76.69 Y108.658 E1.39271
G1 X76.155 Y108.658 E.01647
G1 X108.658 Y76.155 E1.416
G1 X108.658 Y75.62 E.01647
G1 X75.62 Y108.658 E1.43929
G1 X75.086 Y108.658 E.01647
G1 X108.658 Y75.086 E1.46258
G1 X108.658 Y74.551 E.01647
G1 X74.551 Y108.658 E1.48587
G1 X74.016 Y108.658 E.01647
G1 X108.658 Y74.016 E1.50916
G1 X108.658 Y73.482 E.01647
G1 X73.482 Y108.658 E1.53245
G1 X72.947 Y108.658 E.01647
G1 X108.658 Y72.947 E1.55575
G1 X108.658 Y72.413 E.01647
G1 X72.412 Y108.658 E1.57904
G1 X71.878 Y108.658 E.01647
G1 X108.658 Y71.878 E1.60233
G1 X108.658 Y71.343 E.01647
G1 X71.342 Y108.658 E1.62564
G1 X71.342 Y108.124 E.01644
G1 X108.124 Y71.342 E1.6024
G1 X107.589 Y71.342 E.01647
G1 X71.342 Y107.589 E1.57911
G1 X71.342 Y107.055 E.01647
G1 X107.055 Y71.342 E1.55582
G1 X106.52 Y71.342 E.01647
G1 X71.342 Y106.52 E1.53253
G1 X71.342 Y105.985 E.01647
G1 X105.985 Y71.342 E1.50924
G1 X105.451 Y71.342 E.01647
G1 X71.342 Y105.451 E1.48595
G1 X71.342 Y104.916 E.01647
G1 X104.916 Y71.342 E1.46265
G1 X104.381 Y71.342 E.01647
G1 X71.342 Y104.381 E1.43936
G1 X71.342 Y103.847 E.01647
G1 X103.847 Y71.342 E1.41607
G1 X103.312 Y71.342 E.01647
G1 X71.342 Y103.312 E1.39278
G1 X71.342 Y102.778 E.01647
G1 X102.778 Y71.342 E1.36949
G1 X102.243 Y71.342 E.01647
G1 X71.342 Y102.243 E1.3462
G1 X71.342 Y101.708 E.01647
G1 X101.708 Y71.342 E1.32291
G1 X101.174 Y71.342 E.01647
G1 X71.342 Y101.174 E1.29961
G1 X71.342 Y100.639 E.01647
G1 X100.639 Y71.342 E1.27632
G1 X100.104 Y71.342 E.01647
G1 X71.342 Y100.104 E1.25303
G1 X71.342 Y99.57 E.01647
G1 X99.57 Y71.342 E1.22974
G1 X99.035 Y71.342 E.01647
G1 X71.342 Y99.035 E1.20645
G1 X71.342 Y98.501 E.01647
G1 X98.501 Y71.342 E1.18316
G1 X97.966 Y71.342 E.01647
G1 X71.342 Y97.966 E1.15987
G1 X71.342 Y97.431 E.01647
G1 X97.431 Y71.342 E1.13657
G1 X96.897 Y71.342 E.01647
G1 X71.342 Y96.897 E1.11328
G1 X71.342 Y96.362 E.01647
G1 X96.362 Y71.342 E1.08999
G1 X95.827 Y71.342 E.01647
G1 X71.342 Y95.827 E1.0667
G1 X71.342 Y95.293 E.01647
G1 X95.293 Y71.342 E1.04341
G1 X94.758 Y71.342 E.01647
G1 X71.342 Y94.758 E1.02012
G1 X71.342 Y94.223 E.01647
M73 P5 R34
G1 X94.223 Y71.342 E.99683
G1 X93.689 Y71.342 E.01647
G1 X71.342 Y93.689 E.97353
G1 X71.342 Y93.154 E.01647
G1 X93.154 Y71.342 E.95024
G1 X92.62 Y71.342 E.01647
G1 X71.342 Y92.62 E.92695
G1 X71.342 Y92.085 E.01647
G1 X92.085 Y71.342 E.90366
G1 X91.55 Y71.342 E.01647
G1 X71.342 Y91.55 E.88037
G1 X71.342 Y91.016 E.01647
G1 X91.016 Y71.342 E.85708
G1 X90.481 Y71.342 E.01647
G1 X71.342 Y90.481 E.83379
G1 X71.342 Y89.946 E.01647
G1 X89.946 Y71.342 E.81049
G1 X89.412 Y71.342 E.01647
G1 X71.342 Y89.412 E.7872
G1 X71.342 Y88.877 E.01647
G1 X88.877 Y71.342 E.76391
G1 X88.343 Y71.342 E.01647
G1 X71.342 Y88.343 E.74062
M73 P5 R33
G1 X71.342 Y87.808 E.01647
G1 X87.808 Y71.342 E.71733
G1 X87.273 Y71.342 E.01647
G1 X71.342 Y87.273 E.69404
G1 X71.342 Y86.739 E.01647
G1 X86.739 Y71.342 E.67075
G1 X86.204 Y71.342 E.01647
G1 X71.342 Y86.204 E.64745
G1 X71.342 Y85.669 E.01647
G1 X85.669 Y71.342 E.62416
G1 X85.135 Y71.342 E.01647
G1 X71.342 Y85.135 E.60087
G1 X71.342 Y84.6 E.01647
G1 X84.6 Y71.342 E.57758
G1 X84.066 Y71.342 E.01647
G1 X71.342 Y84.066 E.55429
G1 X71.342 Y83.531 E.01647
G1 X83.531 Y71.342 E.531
G1 X82.996 Y71.342 E.01647
G1 X71.342 Y82.996 E.50771
G1 X71.342 Y82.462 E.01647
G1 X82.462 Y71.342 E.48441
G1 X81.927 Y71.342 E.01647
G1 X71.342 Y81.927 E.46112
G1 X71.342 Y81.392 E.01647
G1 X81.392 Y71.342 E.43783
G1 X80.858 Y71.342 E.01647
G1 X71.342 Y80.858 E.41454
G1 X71.342 Y80.323 E.01647
G1 X80.323 Y71.342 E.39125
G1 X79.788 Y71.342 E.01647
G1 X71.342 Y79.788 E.36796
G1 X71.342 Y79.254 E.01647
G1 X79.254 Y71.342 E.34467
G1 X78.719 Y71.342 E.01647
G1 X71.342 Y78.719 E.32137
G1 X71.342 Y78.185 E.01647
G1 X78.185 Y71.342 E.29808
G1 X77.65 Y71.342 E.01647
G1 X71.342 Y77.65 E.27479
G1 X71.342 Y77.115 E.01647
G1 X77.115 Y71.342 E.2515
G1 X76.581 Y71.342 E.01647
G1 X71.342 Y76.581 E.22821
G1 X71.342 Y76.046 E.01647
G1 X76.046 Y71.342 E.20492
G1 X75.511 Y71.342 E.01647
G1 X71.342 Y75.511 E.18163
G1 X71.342 Y74.977 E.01647
G1 X74.977 Y71.342 E.15834
G1 X74.442 Y71.342 E.01647
G1 X71.342 Y74.442 E.13504
G1 X71.342 Y73.908 E.01647
G1 X73.908 Y71.342 E.11175
G1 X73.373 Y71.342 E.01647
G1 X71.342 Y73.373 E.08846
G1 X71.342 Y72.838 E.01647
G1 X72.838 Y71.342 E.06517
G1 X72.304 Y71.342 E.01647
G1 X71.342 Y72.304 E.04188
G1 X71.342 Y71.769 E.01647
G1 X71.939 Y71.173 E.02598
; CHANGE_LAYER
; Z_HEIGHT: 0.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F9522.802
G1 X71.342 Y71.769 E-.32046
G1 X71.342 Y72.304 E-.20316
G1 X71.782 Y71.864 E-.23638
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 3/200
; update layer progress
M73 L3
M991 S0 P2 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z.8 I-.86 J.861 P1  F42000
G1 X108.991 Y108.991 Z.8
G1 Z.6
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F8843.478
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F8843.478
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F9547.055
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z1 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X71.173 Y108.061
G1 Z.6
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42096
G1 F9522.802
M204 S6000
G1 X71.769 Y108.658 E.02598
G1 X72.304 Y108.658 E.01647
G1 X71.342 Y107.696 E.04188
G1 X71.342 Y107.162 E.01647
G1 X72.838 Y108.658 E.06517
G1 X73.373 Y108.658 E.01647
G1 X71.342 Y106.627 E.08846
G1 X71.342 Y106.092 E.01647
G1 X73.908 Y108.658 E.11175
G1 X74.442 Y108.658 E.01647
G1 X71.342 Y105.558 E.13504
G1 X71.342 Y105.023 E.01647
G1 X74.977 Y108.658 E.15834
G1 X75.511 Y108.658 E.01647
G1 X71.342 Y104.489 E.18163
G1 X71.342 Y103.954 E.01647
G1 X76.046 Y108.658 E.20492
G1 X76.581 Y108.658 E.01647
G1 X71.342 Y103.419 E.22821
G1 X71.342 Y102.885 E.01647
G1 X77.115 Y108.658 E.2515
G1 X77.65 Y108.658 E.01647
G1 X71.342 Y102.35 E.27479
G1 X71.342 Y101.815 E.01647
G1 X78.185 Y108.658 E.29808
G1 X78.719 Y108.658 E.01647
G1 X71.342 Y101.281 E.32138
G1 X71.342 Y100.746 E.01647
G1 X79.254 Y108.658 E.34467
G1 X79.788 Y108.658 E.01647
G1 X71.342 Y100.212 E.36796
G1 X71.342 Y99.677 E.01647
G1 X80.323 Y108.658 E.39125
G1 X80.858 Y108.658 E.01647
G1 X71.342 Y99.142 E.41454
G1 X71.342 Y98.608 E.01647
G1 X81.392 Y108.658 E.43783
G1 X81.927 Y108.658 E.01647
G1 X71.342 Y98.073 E.46112
G1 X71.342 Y97.538 E.01647
G1 X82.462 Y108.658 E.48442
G1 X82.996 Y108.658 E.01647
G1 X71.342 Y97.004 E.50771
G1 X71.342 Y96.469 E.01647
G1 X83.531 Y108.658 E.531
G1 X84.066 Y108.658 E.01647
G1 X71.342 Y95.934 E.55429
G1 X71.342 Y95.4 E.01647
G1 X84.6 Y108.658 E.57758
G1 X85.135 Y108.658 E.01647
G1 X71.342 Y94.865 E.60087
G1 X71.342 Y94.331 E.01647
G1 X85.669 Y108.658 E.62416
G1 X86.204 Y108.658 E.01647
G1 X71.342 Y93.796 E.64746
G1 X71.342 Y93.261 E.01647
G1 X86.739 Y108.658 E.67075
G1 X87.273 Y108.658 E.01647
G1 X71.342 Y92.727 E.69404
G1 X71.342 Y92.192 E.01647
G1 X87.808 Y108.658 E.71733
G1 X88.343 Y108.658 E.01647
G1 X71.342 Y91.657 E.74062
G1 X71.342 Y91.123 E.01647
G1 X88.877 Y108.658 E.76391
G1 X89.412 Y108.658 E.01647
G1 X71.342 Y90.588 E.7872
G1 X71.342 Y90.054 E.01647
G1 X89.946 Y108.658 E.8105
G1 X90.481 Y108.658 E.01647
G1 X71.342 Y89.519 E.83379
G1 X71.342 Y88.984 E.01647
G1 X91.016 Y108.658 E.85708
G1 X91.55 Y108.658 E.01647
G1 X71.342 Y88.45 E.88037
G1 X71.342 Y87.915 E.01647
G1 X92.085 Y108.658 E.90366
G1 X92.62 Y108.658 E.01647
G1 X71.342 Y87.38 E.92695
G1 X71.342 Y86.846 E.01647
G1 X93.154 Y108.658 E.95024
G1 X93.689 Y108.658 E.01647
G1 X71.342 Y86.311 E.97353
G1 X71.342 Y85.777 E.01647
G1 X94.223 Y108.658 E.99683
G1 X94.758 Y108.658 E.01647
G1 X71.342 Y85.242 E1.02012
G1 X71.342 Y84.707 E.01647
G1 X95.293 Y108.658 E1.04341
G1 X95.827 Y108.658 E.01647
G1 X71.342 Y84.173 E1.0667
G1 X71.342 Y83.638 E.01647
G1 X96.362 Y108.658 E1.08999
G1 X96.897 Y108.658 E.01647
G1 X71.342 Y83.103 E1.11328
G1 X71.342 Y82.569 E.01647
G1 X97.431 Y108.658 E1.13657
G1 X97.966 Y108.658 E.01647
G1 X71.342 Y82.034 E1.15987
G1 X71.342 Y81.5 E.01647
G1 X98.501 Y108.658 E1.18316
G1 X99.035 Y108.658 E.01647
G1 X71.342 Y80.965 E1.20645
G1 X71.342 Y80.43 E.01647
G1 X99.57 Y108.658 E1.22974
G1 X100.104 Y108.658 E.01647
G1 X71.342 Y79.896 E1.25303
G1 X71.342 Y79.361 E.01647
G1 X100.639 Y108.658 E1.27632
G1 X101.174 Y108.658 E.01647
G1 X71.342 Y78.826 E1.29961
G1 X71.342 Y78.292 E.01647
G1 X101.708 Y108.658 E1.32291
G1 X102.243 Y108.658 E.01647
G1 X71.342 Y77.757 E1.3462
G1 X71.342 Y77.222 E.01647
G1 X102.778 Y108.658 E1.36949
G1 X103.312 Y108.658 E.01647
G1 X71.342 Y76.688 E1.39278
G1 X71.342 Y76.153 E.01647
G1 X103.847 Y108.658 E1.41607
G1 X104.381 Y108.658 E.01647
G1 X71.342 Y75.619 E1.43936
M73 P6 R33
G1 X71.342 Y75.084 E.01647
G1 X104.916 Y108.658 E1.46265
G1 X105.451 Y108.658 E.01647
G1 X71.342 Y74.549 E1.48595
G1 X71.342 Y74.015 E.01647
G1 X105.985 Y108.658 E1.50924
G1 X106.52 Y108.658 E.01647
G1 X71.342 Y73.48 E1.53253
G1 X71.342 Y72.945 E.01647
G1 X107.055 Y108.658 E1.55582
G1 X107.589 Y108.658 E.01647
G1 X71.342 Y72.411 E1.57911
G1 X71.342 Y71.876 E.01647
G1 X108.124 Y108.658 E1.6024
G1 X108.658 Y108.658 E.01644
G1 X71.343 Y71.342 E1.62564
G1 X71.878 Y71.342 E.01647
G1 X108.658 Y108.122 E1.60233
G1 X108.658 Y107.588 E.01647
G1 X72.413 Y71.342 E1.57904
G1 X72.947 Y71.342 E.01647
G1 X108.658 Y107.053 E1.55575
G1 X108.658 Y106.518 E.01647
G1 X73.482 Y71.342 E1.53245
G1 X74.016 Y71.342 E.01647
G1 X108.658 Y105.984 E1.50916
G1 X108.658 Y105.449 E.01647
G1 X74.551 Y71.342 E1.48587
G1 X75.086 Y71.342 E.01647
G1 X108.658 Y104.914 E1.46258
G1 X108.658 Y104.38 E.01647
G1 X75.62 Y71.342 E1.43929
G1 X76.155 Y71.342 E.01647
G1 X108.658 Y103.845 E1.416
G1 X108.658 Y103.31 E.01647
G1 X76.69 Y71.342 E1.39271
G1 X77.224 Y71.342 E.01647
G1 X108.658 Y102.776 E1.36941
G1 X108.658 Y102.241 E.01647
G1 X77.759 Y71.342 E1.34612
G1 X78.293 Y71.342 E.01647
G1 X108.658 Y101.707 E1.32283
G1 X108.658 Y101.172 E.01647
G1 X78.828 Y71.342 E1.29954
G1 X79.363 Y71.342 E.01647
G1 X108.658 Y100.637 E1.27625
G1 X108.658 Y100.103 E.01647
G1 X79.897 Y71.342 E1.25296
G1 X80.432 Y71.342 E.01647
G1 X108.658 Y99.568 E1.22967
G1 X108.658 Y99.033 E.01647
G1 X80.967 Y71.342 E1.20637
G1 X81.501 Y71.342 E.01647
G1 X108.658 Y98.499 E1.18308
G1 X108.658 Y97.964 E.01647
G1 X82.036 Y71.342 E1.15979
G1 X82.57 Y71.342 E.01647
G1 X108.658 Y97.43 E1.1365
G1 X108.658 Y96.895 E.01647
G1 X83.105 Y71.342 E1.11321
G1 X83.64 Y71.342 E.01647
G1 X108.658 Y96.36 E1.08992
G1 X108.658 Y95.826 E.01647
G1 X84.174 Y71.342 E1.06663
G1 X84.709 Y71.342 E.01647
G1 X108.658 Y95.291 E1.04333
G1 X108.658 Y94.756 E.01647
G1 X85.244 Y71.342 E1.02004
G1 X85.778 Y71.342 E.01647
G1 X108.658 Y94.222 E.99675
G1 X108.658 Y93.687 E.01647
G1 X86.313 Y71.342 E.97346
G1 X86.848 Y71.342 E.01647
G1 X108.658 Y93.153 E.95017
G1 X108.658 Y92.618 E.01647
G1 X87.382 Y71.342 E.92688
G1 X87.917 Y71.342 E.01647
G1 X108.658 Y92.083 E.90359
G1 X108.658 Y91.549 E.01647
G1 X88.451 Y71.342 E.88029
G1 X88.986 Y71.342 E.01647
G1 X108.658 Y91.014 E.857
G1 X108.658 Y90.479 E.01647
G1 X89.521 Y71.342 E.83371
G1 X90.055 Y71.342 E.01647
G1 X108.658 Y89.945 E.81042
G1 X108.658 Y89.41 E.01647
G1 X90.59 Y71.342 E.78713
G1 X91.125 Y71.342 E.01647
G1 X108.658 Y88.875 E.76384
G1 X108.658 Y88.341 E.01647
G1 X91.659 Y71.342 E.74055
G1 X92.194 Y71.342 E.01647
G1 X108.658 Y87.806 E.71726
G1 X108.658 Y87.272 E.01647
G1 X92.728 Y71.342 E.69396
G1 X93.263 Y71.342 E.01647
G1 X108.658 Y86.737 E.67067
G1 X108.658 Y86.202 E.01647
G1 X93.798 Y71.342 E.64738
G1 X94.332 Y71.342 E.01647
G1 X108.658 Y85.668 E.62409
G1 X108.658 Y85.133 E.01647
G1 X94.867 Y71.342 E.6008
G1 X95.402 Y71.342 E.01647
G1 X108.658 Y84.598 E.57751
G1 X108.658 Y84.064 E.01647
G1 X95.936 Y71.342 E.55422
G1 X96.471 Y71.342 E.01647
G1 X108.658 Y83.529 E.53092
G1 X108.658 Y82.995 E.01647
G1 X97.005 Y71.342 E.50763
G1 X97.54 Y71.342 E.01647
G1 X108.658 Y82.46 E.48434
G1 X108.658 Y81.925 E.01647
G1 X98.075 Y71.342 E.46105
G1 X98.609 Y71.342 E.01647
G1 X108.658 Y81.391 E.43776
G1 X108.658 Y80.856 E.01647
G1 X99.144 Y71.342 E.41447
G1 X99.679 Y71.342 E.01647
G1 X108.658 Y80.321 E.39118
G1 X108.658 Y79.787 E.01647
G1 X100.213 Y71.342 E.36788
G1 X100.748 Y71.342 E.01647
G1 X108.658 Y79.252 E.34459
G1 X108.658 Y78.718 E.01647
G1 X101.282 Y71.342 E.3213
G1 X101.817 Y71.342 E.01647
G1 X108.658 Y78.183 E.29801
G1 X108.658 Y77.648 E.01647
G1 X102.352 Y71.342 E.27472
G1 X102.886 Y71.342 E.01647
G1 X108.658 Y77.114 E.25143
G1 X108.658 Y76.579 E.01647
G1 X103.421 Y71.342 E.22814
G1 X103.956 Y71.342 E.01647
G1 X108.658 Y76.044 E.20484
G1 X108.658 Y75.51 E.01647
G1 X104.49 Y71.342 E.18155
G1 X105.025 Y71.342 E.01647
G1 X108.658 Y74.975 E.15826
G1 X108.658 Y74.441 E.01647
G1 X105.56 Y71.342 E.13497
G1 X106.094 Y71.342 E.01647
G1 X108.658 Y73.906 E.11168
G1 X108.658 Y73.371 E.01647
G1 X106.629 Y71.342 E.08839
G1 X107.163 Y71.342 E.01647
G1 X108.658 Y72.837 E.0651
G1 X108.658 Y72.302 E.01647
G1 X107.698 Y71.342 E.04181
G1 X108.233 Y71.342 E.01647
G1 X108.827 Y71.937 E.02591
; CHANGE_LAYER
; Z_HEIGHT: 0.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F9522.802
G1 X108.233 Y71.342 E-.31956
G1 X107.698 Y71.342 E-.20316
G1 X108.14 Y71.784 E-.23728
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 4/200
; update layer progress
M73 L4
M991 S0 P3 ;notify layer change
M106 S201.45
; OBJECT_ID: 15
M204 S10000
G17
G3 Z1 I-1.217 J.028 P1  F42000
G1 X108.991 Y108.991 Z1
G1 Z.8
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F7911
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7911
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7911
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
M73 P7 R33
G1 E-.04 F1800
M204 S10000
G17
G3 Z1.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7911
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 1
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 5/200
; update layer progress
M73 L5
M991 S0 P4 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z1.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z1.2
G1 Z1
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z1.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z1
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 1.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 6/200
; update layer progress
M73 L6
M991 S0 P5 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z1.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z1.4
G1 Z1.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z1.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z1.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
M73 P7 R32
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
M73 P8 R32
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 1.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 7/200
; update layer progress
M73 L7
M991 S0 P6 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z1.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z1.6
G1 Z1.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z1.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z1.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 1.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 8/200
; update layer progress
M73 L8
M991 S0 P7 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z1.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z1.8
G1 Z1.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z1.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 1.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 9/200
; update layer progress
M73 L9
M991 S0 P8 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z2
G1 Z1.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
M73 P9 R32
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z2.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z1.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 10/200
; update layer progress
M73 L10
M991 S0 P9 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z2.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z2.2
G1 Z2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z2.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 2.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 11/200
; update layer progress
M73 L11
M991 S0 P10 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z2.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z2.4
G1 Z2.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
M73 P10 R32
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z2.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z2.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 2.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 12/200
; update layer progress
M73 L12
M991 S0 P11 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z2.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z2.6
G1 Z2.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z2.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z2.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 2.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 13/200
; update layer progress
M73 L13
M991 S0 P12 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z2.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z2.8
G1 Z2.6
G1 E.8 F1800
; FEATURE: Inner wall
M73 P10 R31
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z3 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z2.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
M73 P11 R31
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 2.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 14/200
; update layer progress
M73 L14
M991 S0 P13 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z3 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z3
G1 Z2.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z3.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z2.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 3
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 15/200
; update layer progress
M73 L15
M991 S0 P14 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z3.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z3.2
G1 Z3
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z3.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z3
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 3.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 16/200
; update layer progress
M73 L16
M991 S0 P15 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z3.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z3.4
G1 Z3.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
M73 P12 R31
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z3.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z3.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 3.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 17/200
; update layer progress
M73 L17
M991 S0 P16 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z3.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z3.6
G1 Z3.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z3.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z3.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 3.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 18/200
; update layer progress
M73 L18
M991 S0 P17 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z3.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z3.8
G1 Z3.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
M73 P13 R31
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z3.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 3.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 19/200
; update layer progress
M73 L19
M991 S0 P18 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z4
G1 Z3.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z4.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z3.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
M73 P13 R30
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 20/200
; update layer progress
M73 L20
M991 S0 P19 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z4.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z4.2
G1 Z4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z4.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
M73 P14 R30
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 4.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 21/200
; update layer progress
M73 L21
M991 S0 P20 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z4.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z4.4
G1 Z4.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z4.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z4.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 4.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 22/200
; update layer progress
M73 L22
M991 S0 P21 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z4.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z4.6
G1 Z4.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z4.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z4.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 4.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
M73 P15 R30
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 23/200
; update layer progress
M73 L23
M991 S0 P22 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z4.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z4.8
G1 Z4.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z5 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z4.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 4.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 24/200
; update layer progress
M73 L24
M991 S0 P23 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z5 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z5
G1 Z4.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z5.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z4.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 5
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 25/200
; update layer progress
M73 L25
M991 S0 P24 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z5.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z5.2
G1 Z5
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
M73 P16 R30
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z5.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z5
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 5.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
M73 P16 R29
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 26/200
; update layer progress
M73 L26
M991 S0 P25 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z5.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z5.4
G1 Z5.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z5.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z5.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 5.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 27/200
; update layer progress
M73 L27
M991 S0 P26 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z5.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z5.6
G1 Z5.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z5.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z5.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
M73 P17 R29
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 5.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 28/200
; update layer progress
M73 L28
M991 S0 P27 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z5.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z5.8
G1 Z5.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z5.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 5.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 29/200
; update layer progress
M73 L29
M991 S0 P28 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z6
G1 Z5.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z6.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z5.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
M73 P18 R29
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 30/200
; update layer progress
M73 L30
M991 S0 P29 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z6.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z6.2
G1 Z6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z6.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 6.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 31/200
; update layer progress
M73 L31
M991 S0 P30 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z6.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z6.4
G1 Z6.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z6.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z6.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 6.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 32/200
; update layer progress
M73 L32
M991 S0 P31 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z6.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z6.6
G1 Z6.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
M73 P19 R29
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z6.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z6.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
M73 P19 R28
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 6.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 33/200
; update layer progress
M73 L33
M991 S0 P32 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z6.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z6.8
G1 Z6.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z7 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z6.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 6.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 34/200
; update layer progress
M73 L34
M991 S0 P33 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z7 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z7
G1 Z6.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z7.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z6.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
M73 P20 R28
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 7
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 35/200
; update layer progress
M73 L35
M991 S0 P34 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z7.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z7.2
G1 Z7
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z7.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z7
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 7.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 36/200
; update layer progress
M73 L36
M991 S0 P35 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z7.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z7.4
G1 Z7.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z7.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z7.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
M73 P21 R28
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 7.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 37/200
; update layer progress
M73 L37
M991 S0 P36 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z7.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z7.6
G1 Z7.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z7.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z7.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 7.6
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 38/200
; update layer progress
M73 L38
M991 S0 P37 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z7.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z7.8
G1 Z7.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z7.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 7.8
; LAYER_HEIGHT: 0.2
; WIPE_START
M73 P21 R27
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 39/200
; update layer progress
M73 L39
M991 S0 P38 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z8
G1 Z7.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
M73 P22 R27
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z8.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z7.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 40/200
; update layer progress
M73 L40
M991 S0 P39 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z8.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z8.2
G1 Z8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z8.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 8.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 41/200
; update layer progress
M73 L41
M991 S0 P40 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z8.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z8.4
G1 Z8.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z8.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z8.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
M73 P23 R27
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 8.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 42/200
; update layer progress
M73 L42
M991 S0 P41 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z8.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z8.6
G1 Z8.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z8.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z8.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 8.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 43/200
; update layer progress
M73 L43
M991 S0 P42 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z8.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z8.8
G1 Z8.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z9 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z8.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
M73 P24 R27
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 8.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 44/200
; update layer progress
M73 L44
M991 S0 P43 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z9 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z9
G1 Z8.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z9.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z8.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 9
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 45/200
; update layer progress
M73 L45
M991 S0 P44 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z9.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z9.2
G1 Z9
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
M73 P24 R26
G1 E-.04 F1800
M204 S10000
G17
G3 Z9.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z9
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 9.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 46/200
; update layer progress
M73 L46
M991 S0 P45 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z9.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z9.4
G1 Z9.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
M73 P25 R26
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z9.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z9.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 9.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 47/200
; update layer progress
M73 L47
M991 S0 P46 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z9.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z9.6
G1 Z9.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z9.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z9.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 9.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 48/200
; update layer progress
M73 L48
M991 S0 P47 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z9.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z9.8
G1 Z9.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z10 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z9.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
M73 P26 R26
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 9.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 49/200
; update layer progress
M73 L49
M991 S0 P48 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z10 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z10
G1 Z9.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z10.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z9.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 10
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 50/200
; update layer progress
M73 L50
M991 S0 P49 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z10.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z10.2
G1 Z10
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z10.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z10
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
M73 P27 R26
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 10.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 51/200
; update layer progress
M73 L51
M991 S0 P50 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z10.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z10.4
G1 Z10.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z10.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z10.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
M73 P27 R25
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 10.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 52/200
; update layer progress
M73 L52
M991 S0 P51 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z10.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z10.6
G1 Z10.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z10.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z10.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 10.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 53/200
; update layer progress
M73 L53
M991 S0 P52 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z10.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z10.8
G1 Z10.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
M73 P28 R25
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z11 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z10.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 10.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 54/200
; update layer progress
M73 L54
M991 S0 P53 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z11 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z11
G1 Z10.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z11.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z10.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 11
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 55/200
; update layer progress
M73 L55
M991 S0 P54 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z11.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z11.2
G1 Z11
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z11.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z11
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
M73 P29 R25
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 11.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 56/200
; update layer progress
M73 L56
M991 S0 P55 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z11.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z11.4
G1 Z11.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z11.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z11.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 11.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 57/200
; update layer progress
M73 L57
M991 S0 P56 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z11.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z11.6
G1 Z11.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z11.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z11.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
M73 P30 R25
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 11.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 58/200
; update layer progress
M73 L58
M991 S0 P57 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z11.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z11.8
G1 Z11.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
M73 P30 R24
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z12 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z11.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 11.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 59/200
; update layer progress
M73 L59
M991 S0 P58 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z12 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z12
G1 Z11.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z12.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z11.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 12
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 60/200
; update layer progress
M73 L60
M991 S0 P59 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z12.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z12.2
G1 Z12
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
M73 P31 R24
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z12.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z12
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 12.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 61/200
; update layer progress
M73 L61
M991 S0 P60 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z12.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z12.4
G1 Z12.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z12.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z12.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 12.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 62/200
; update layer progress
M73 L62
M991 S0 P61 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z12.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z12.6
G1 Z12.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z12.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z12.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
M73 P32 R24
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 12.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 63/200
; update layer progress
M73 L63
M991 S0 P62 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z12.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z12.8
G1 Z12.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z13 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z12.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 12.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 64/200
; update layer progress
M73 L64
M991 S0 P63 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z13 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z13
G1 Z12.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z13.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z12.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
M73 P33 R24
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
M73 P33 R23
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 13
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 65/200
; update layer progress
M73 L65
M991 S0 P64 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z13.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z13.2
G1 Z13
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z13.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z13
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 13.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 66/200
; update layer progress
M73 L66
M991 S0 P65 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z13.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z13.4
G1 Z13.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z13.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z13.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 13.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 67/200
; update layer progress
M73 L67
M991 S0 P66 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z13.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z13.6
G1 Z13.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
M73 P34 R23
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z13.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z13.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 13.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 68/200
; update layer progress
M73 L68
M991 S0 P67 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z13.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z13.8
G1 Z13.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z14 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z13.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 13.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 69/200
; update layer progress
M73 L69
M991 S0 P68 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z14 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z14
G1 Z13.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z14.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

M73 P35 R23
G1 X108.643 Y72.986
G1 Z13.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 14
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 70/200
; update layer progress
M73 L70
M991 S0 P69 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z14.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z14.2
G1 Z14
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z14.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z14
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 14.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 71/200
; update layer progress
M73 L71
M991 S0 P70 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z14.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z14.4
G1 Z14.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
M73 P35 R22
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z14.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z14.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
M73 P36 R22
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 14.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 72/200
; update layer progress
M73 L72
M991 S0 P71 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z14.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z14.6
G1 Z14.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z14.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z14.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 14.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 73/200
; update layer progress
M73 L73
M991 S0 P72 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z14.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z14.8
G1 Z14.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z15 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z14.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 14.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 74/200
; update layer progress
M73 L74
M991 S0 P73 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z15 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z15
G1 Z14.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
M73 P37 R22
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z15.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z14.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 15
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 75/200
; update layer progress
M73 L75
M991 S0 P74 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z15.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z15.2
G1 Z15
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z15.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z15
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 15.2
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 76/200
; update layer progress
M73 L76
M991 S0 P75 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z15.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z15.4
G1 Z15.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
M73 P38 R22
G1 E-.04 F1800
M204 S10000
G17
G3 Z15.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z15.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 15.4
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 77/200
; update layer progress
M73 L77
M991 S0 P76 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z15.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z15.6
G1 Z15.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z15.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z15.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
M73 P38 R21
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 15.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 78/200
; update layer progress
M73 L78
M991 S0 P77 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z15.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z15.8
G1 Z15.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z16 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z15.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
M73 P39 R21
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 15.8
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 79/200
; update layer progress
M73 L79
M991 S0 P78 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z16 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z16
G1 Z15.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z16.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z15.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 16
; LAYER_HEIGHT: 0.2
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 80/200
; update layer progress
M73 L80
M991 S0 P79 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z16.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z16.2
G1 Z16
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z16.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z16
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 16.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 81/200
; update layer progress
M73 L81
M991 S0 P80 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z16.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z16.4
G1 Z16.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
M73 P40 R21
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z16.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z16.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 16.4
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 82/200
; update layer progress
M73 L82
M991 S0 P81 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z16.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z16.6
G1 Z16.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z16.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z16.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 16.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 83/200
; update layer progress
M73 L83
M991 S0 P82 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z16.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z16.8
G1 Z16.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
M73 P41 R21
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z17 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z16.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 16.8
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 84/200
; update layer progress
M73 L84
M991 S0 P83 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z17 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z17
G1 Z16.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
M73 P41 R20
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z17.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z16.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 17
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 85/200
; update layer progress
M73 L85
M991 S0 P84 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z17.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z17.2
G1 Z17
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z17.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z17
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
M73 P42 R20
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 17.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 86/200
; update layer progress
M73 L86
M991 S0 P85 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z17.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z17.4
G1 Z17.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z17.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z17.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 17.4
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 87/200
; update layer progress
M73 L87
M991 S0 P86 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z17.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z17.6
G1 Z17.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z17.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z17.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 17.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 88/200
; update layer progress
M73 L88
M991 S0 P87 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z17.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z17.8
G1 Z17.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
M73 P43 R20
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z18 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z17.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 17.8
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 89/200
; update layer progress
M73 L89
M991 S0 P88 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z18 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z18
G1 Z17.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z18.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z17.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 18
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 90/200
; update layer progress
M73 L90
M991 S0 P89 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z18.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z18.2
G1 Z18
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
M73 P44 R20
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z18.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z18
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
M73 P44 R19
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 18.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 91/200
; update layer progress
M73 L91
M991 S0 P90 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z18.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z18.4
G1 Z18.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z18.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z18.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 18.4
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 92/200
; update layer progress
M73 L92
M991 S0 P91 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z18.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z18.6
G1 Z18.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z18.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z18.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
M73 P45 R19
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 18.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 93/200
; update layer progress
M73 L93
M991 S0 P92 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z18.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z18.8
G1 Z18.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z19 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z18.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 18.8
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 94/200
; update layer progress
M73 L94
M991 S0 P93 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z19 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z19
G1 Z18.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z19.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z18.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 19
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
M73 P46 R19
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 95/200
; update layer progress
M73 L95
M991 S0 P94 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z19.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z19.2
G1 Z19
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z19.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z19
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 19.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 96/200
; update layer progress
M73 L96
M991 S0 P95 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z19.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z19.4
G1 Z19.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z19.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z19.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 19.4
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 97/200
; update layer progress
M73 L97
M991 S0 P96 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z19.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z19.6
G1 Z19.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
M73 P46 R18
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
M73 P47 R18
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z19.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z19.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 19.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 98/200
; update layer progress
M73 L98
M991 S0 P97 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z19.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z19.8
G1 Z19.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z20 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z19.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 19.8
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 99/200
; update layer progress
M73 L99
M991 S0 P98 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z20 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z20
G1 Z19.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z20.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z19.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
M73 P48 R18
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 20
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 100/200
; update layer progress
M73 L100
M991 S0 P99 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z20.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z20.2
G1 Z20
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z20.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z20
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 20.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 101/200
; update layer progress
M73 L101
M991 S0 P100 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z20.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z20.4
G1 Z20.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z20.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z20.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 20.4
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
M73 P49 R18
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 102/200
; update layer progress
M73 L102
M991 S0 P101 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z20.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z20.6
G1 Z20.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z20.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z20.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 20.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 103/200
; update layer progress
M73 L103
M991 S0 P102 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z20.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z20.8
G1 Z20.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z21 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z20.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
M73 P49 R17
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 20.8
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 104/200
; update layer progress
M73 L104
M991 S0 P103 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z21 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z21
G1 Z20.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
M73 P50 R17
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z21.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z20.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 21
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 105/200
; update layer progress
M73 L105
M991 S0 P104 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z21.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z21.2
G1 Z21
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z21.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z21
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 21.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 106/200
; update layer progress
M73 L106
M991 S0 P105 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z21.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z21.4
G1 Z21.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z21.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z21.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
M73 P51 R17
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 21.4
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 107/200
; update layer progress
M73 L107
M991 S0 P106 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z21.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z21.6
G1 Z21.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z21.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z21.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 21.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 108/200
; update layer progress
M73 L108
M991 S0 P107 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z21.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z21.8
G1 Z21.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z22 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z21.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
M73 P52 R17
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 21.8
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 109/200
; update layer progress
M73 L109
M991 S0 P108 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z22 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z22
G1 Z21.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z22.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z21.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 22
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 110/200
; update layer progress
M73 L110
M991 S0 P109 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z22.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z22.2
G1 Z22
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
M73 P52 R16
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z22.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z22
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 22.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 111/200
; update layer progress
M73 L111
M991 S0 P110 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z22.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z22.4
G1 Z22.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
M73 P53 R16
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z22.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z22.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 22.4
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 112/200
; update layer progress
M73 L112
M991 S0 P111 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z22.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z22.6
G1 Z22.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z22.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z22.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 22.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 113/200
; update layer progress
M73 L113
M991 S0 P112 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z22.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z22.8
G1 Z22.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z23 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z22.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
M73 P54 R16
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 22.8
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 114/200
; update layer progress
M73 L114
M991 S0 P113 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z23 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z23
G1 Z22.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z23.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z22.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 23
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 115/200
; update layer progress
M73 L115
M991 S0 P114 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z23.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z23.2
G1 Z23
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z23.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z23
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
M73 P55 R16
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 23.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 116/200
; update layer progress
M73 L116
M991 S0 P115 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z23.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z23.4
G1 Z23.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z23.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z23.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
M73 P55 R15
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 23.4
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 117/200
; update layer progress
M73 L117
M991 S0 P116 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z23.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z23.6
G1 Z23.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z23.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z23.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 23.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 118/200
; update layer progress
M73 L118
M991 S0 P117 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z23.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z23.8
G1 Z23.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
M73 P56 R15
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z24 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z23.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 23.8
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 119/200
; update layer progress
M73 L119
M991 S0 P118 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z24 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z24
G1 Z23.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z24.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z23.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 24
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 120/200
; update layer progress
M73 L120
M991 S0 P119 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z24.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z24.2
G1 Z24
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z24.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z24
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
M73 P57 R15
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 24.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 121/200
; update layer progress
M73 L121
M991 S0 P120 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z24.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z24.4
G1 Z24.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z24.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z24.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 24.4
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 122/200
; update layer progress
M73 L122
M991 S0 P121 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z24.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z24.6
G1 Z24.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z24.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z24.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
M73 P58 R15
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 24.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 123/200
; update layer progress
M73 L123
M991 S0 P122 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z24.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z24.8
G1 Z24.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
M73 P58 R14
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z25 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z24.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 24.8
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 124/200
; update layer progress
M73 L124
M991 S0 P123 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z25 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z25
G1 Z24.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z25.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z24.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 25
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 125/200
; update layer progress
M73 L125
M991 S0 P124 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z25.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z25.2
G1 Z25
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
M73 P59 R14
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z25.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z25
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 25.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 126/200
; update layer progress
M73 L126
M991 S0 P125 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z25.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z25.4
G1 Z25.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z25.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z25.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 25.4
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 127/200
; update layer progress
M73 L127
M991 S0 P126 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z25.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z25.6
G1 Z25.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z25.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z25.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
M73 P60 R14
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 25.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 128/200
; update layer progress
M73 L128
M991 S0 P127 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z25.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z25.8
G1 Z25.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z26 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z25.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 25.8
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 129/200
; update layer progress
M73 L129
M991 S0 P128 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z26 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z26
G1 Z25.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z26.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z25.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
M73 P60 R13
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
M73 P61 R13
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 26
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 130/200
; update layer progress
M73 L130
M991 S0 P129 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z26.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z26.2
G1 Z26
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z26.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z26
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 26.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 131/200
; update layer progress
M73 L131
M991 S0 P130 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z26.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z26.4
G1 Z26.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z26.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z26.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 26.4
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 132/200
; update layer progress
M73 L132
M991 S0 P131 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z26.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z26.6
G1 Z26.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
M73 P62 R13
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z26.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z26.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 26.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 133/200
; update layer progress
M73 L133
M991 S0 P132 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z26.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z26.8
G1 Z26.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z27 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z26.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 26.8
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 134/200
; update layer progress
M73 L134
M991 S0 P133 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z27 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z27
G1 Z26.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z27.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z26.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
M73 P63 R13
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 27
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 135/200
; update layer progress
M73 L135
M991 S0 P134 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z27.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z27.2
G1 Z27
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z27.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z27
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 27.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 136/200
; update layer progress
M73 L136
M991 S0 P135 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z27.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z27.4
G1 Z27.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
M73 P63 R12
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z27.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z27.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
M73 P64 R12
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 27.4
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 137/200
; update layer progress
M73 L137
M991 S0 P136 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z27.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z27.6
G1 Z27.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z27.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z27.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 27.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 138/200
; update layer progress
M73 L138
M991 S0 P137 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z27.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z27.8
G1 Z27.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z28 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z27.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 27.8
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 139/200
; update layer progress
M73 L139
M991 S0 P138 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z28 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z28
G1 Z27.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
M73 P65 R12
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z28.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z27.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 28
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 140/200
; update layer progress
M73 L140
M991 S0 P139 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z28.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z28.2
G1 Z28
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z28.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z28
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 28.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 141/200
; update layer progress
M73 L141
M991 S0 P140 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z28.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z28.4
G1 Z28.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z28.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z28.2
M73 P66 R12
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 28.4
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 142/200
; update layer progress
M73 L142
M991 S0 P141 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z28.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z28.6
G1 Z28.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z28.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z28.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
M73 P66 R11
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 28.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 143/200
; update layer progress
M73 L143
M991 S0 P142 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z28.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z28.8
G1 Z28.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z29 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z28.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
M73 P67 R11
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 28.8
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 144/200
; update layer progress
M73 L144
M991 S0 P143 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z29 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z29
G1 Z28.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z29.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z28.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 29
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 145/200
; update layer progress
M73 L145
M991 S0 P144 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z29.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z29.2
G1 Z29
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z29.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z29
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 29.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 146/200
; update layer progress
M73 L146
M991 S0 P145 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z29.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z29.4
G1 Z29.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
M73 P68 R11
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z29.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z29.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 29.4
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 147/200
; update layer progress
M73 L147
M991 S0 P146 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z29.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z29.6
G1 Z29.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z29.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z29.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 29.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 148/200
; update layer progress
M73 L148
M991 S0 P147 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z29.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z29.8
G1 Z29.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
M73 P69 R11
G1 E-.04 F1800
M204 S10000
G17
G3 Z30 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z29.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 29.8
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 149/200
; update layer progress
M73 L149
M991 S0 P148 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z30 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z30
G1 Z29.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
M73 P69 R10
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z30.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z29.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 30
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 150/200
; update layer progress
M73 L150
M991 S0 P149 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z30.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z30.2
G1 Z30
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z30.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z30
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
M73 P70 R10
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 30.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 151/200
; update layer progress
M73 L151
M991 S0 P150 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z30.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z30.4
G1 Z30.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z30.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z30.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 30.4
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 152/200
; update layer progress
M73 L152
M991 S0 P151 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z30.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z30.6
G1 Z30.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z30.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z30.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 30.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 153/200
; update layer progress
M73 L153
M991 S0 P152 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z30.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z30.8
G1 Z30.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
M73 P71 R10
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z31 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z30.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 30.8
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 154/200
; update layer progress
M73 L154
M991 S0 P153 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z31 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z31
G1 Z30.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z31.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z30.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 31
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 155/200
; update layer progress
M73 L155
M991 S0 P154 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z31.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z31.2
G1 Z31
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
M73 P72 R10
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z31.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z31
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
M73 P72 R9
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 31.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 156/200
; update layer progress
M73 L156
M991 S0 P155 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z31.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z31.4
G1 Z31.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z31.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z31.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 31.4
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 157/200
; update layer progress
M73 L157
M991 S0 P156 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z31.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z31.6
G1 Z31.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z31.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z31.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
M73 P73 R9
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 31.6
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 158/200
; update layer progress
M73 L158
M991 S0 P157 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z31.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z31.8
G1 Z31.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z32 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z31.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 31.8
; LAYER_HEIGHT: 0.199999
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 159/200
; update layer progress
M73 L159
M991 S0 P158 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z32 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z32
G1 Z31.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z32.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z31.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 32
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 160/200
; update layer progress
M73 L160
M991 S0 P159 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z32.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z32.2
G1 Z32
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
M73 P74 R9
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z32.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z32
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 32.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 161/200
; update layer progress
M73 L161
M991 S0 P160 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z32.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z32.4
G1 Z32.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z32.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z32.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 32.4
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 162/200
; update layer progress
M73 L162
M991 S0 P161 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z32.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z32.6
G1 Z32.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
M73 P74 R8
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
M73 P75 R8
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z32.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z32.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 32.6
; LAYER_HEIGHT: 0.199997
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 163/200
; update layer progress
M73 L163
M991 S0 P162 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z32.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z32.8
G1 Z32.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z33 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z32.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 32.8
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 164/200
; update layer progress
M73 L164
M991 S0 P163 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z33 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z33
G1 Z32.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z33.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z32.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
M73 P76 R8
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 33
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 165/200
; update layer progress
M73 L165
M991 S0 P164 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z33.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z33.2
G1 Z33
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z33.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z33
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 33.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 166/200
; update layer progress
M73 L166
M991 S0 P165 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z33.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z33.4
G1 Z33.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z33.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z33.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 33.4
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
M73 P77 R8
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 167/200
; update layer progress
M73 L167
M991 S0 P166 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z33.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z33.6
G1 Z33.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z33.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z33.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 33.6
; LAYER_HEIGHT: 0.199997
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 168/200
; update layer progress
M73 L168
M991 S0 P167 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z33.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z33.8
G1 Z33.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z34 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z33.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
M73 P77 R7
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 33.8
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 169/200
; update layer progress
M73 L169
M991 S0 P168 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z34 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z34
G1 Z33.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
M73 P78 R7
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z34.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z33.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 34
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 170/200
; update layer progress
M73 L170
M991 S0 P169 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z34.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z34.2
G1 Z34
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z34.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z34
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 34.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 171/200
; update layer progress
M73 L171
M991 S0 P170 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z34.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z34.4
G1 Z34.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z34.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z34.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
M73 P79 R7
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 34.4
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 172/200
; update layer progress
M73 L172
M991 S0 P171 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z34.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z34.6
G1 Z34.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z34.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z34.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 34.6
; LAYER_HEIGHT: 0.199997
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 173/200
; update layer progress
M73 L173
M991 S0 P172 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z34.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z34.8
G1 Z34.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z35 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z34.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 34.8
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
M73 P80 R7
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 174/200
; update layer progress
M73 L174
M991 S0 P173 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z35 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z35
G1 Z34.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z35.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z34.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 35
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 175/200
; update layer progress
M73 L175
M991 S0 P174 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z35.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z35.2
G1 Z35
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
M73 P80 R6
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z35.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z35
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 35.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 176/200
; update layer progress
M73 L176
M991 S0 P175 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z35.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z35.4
G1 Z35.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
M73 P81 R6
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z35.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z35.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 35.4
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 177/200
; update layer progress
M73 L177
M991 S0 P176 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z35.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z35.6
G1 Z35.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z35.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z35.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 35.6
; LAYER_HEIGHT: 0.199997
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 178/200
; update layer progress
M73 L178
M991 S0 P177 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z35.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z35.8
G1 Z35.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z36 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z35.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
M73 P82 R6
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 35.8
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 179/200
; update layer progress
M73 L179
M991 S0 P178 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z36 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z36
G1 Z35.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z36.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z35.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 36
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 180/200
; update layer progress
M73 L180
M991 S0 P179 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z36.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z36.2
G1 Z36
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z36.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z36
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
M73 P83 R6
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 36.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 181/200
; update layer progress
M73 L181
M991 S0 P180 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z36.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z36.4
G1 Z36.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z36.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z36.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
M73 P83 R5
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 36.4
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 182/200
; update layer progress
M73 L182
M991 S0 P181 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z36.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z36.6
G1 Z36.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z36.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z36.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 36.6
; LAYER_HEIGHT: 0.199997
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 183/200
; update layer progress
M73 L183
M991 S0 P182 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z36.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z36.8
G1 Z36.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
M73 P84 R5
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z37 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z36.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 36.8
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 184/200
; update layer progress
M73 L184
M991 S0 P183 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z37 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z37
G1 Z36.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z37.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z36.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 37
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 185/200
; update layer progress
M73 L185
M991 S0 P184 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z37.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z37.2
G1 Z37
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z37.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z37
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
M73 P85 R5
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 37.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 186/200
; update layer progress
M73 L186
M991 S0 P185 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z37.4 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z37.4
G1 Z37.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z37.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z37.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 37.4
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 187/200
; update layer progress
M73 L187
M991 S0 P186 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z37.6 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z37.6
G1 Z37.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z37.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z37.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
M73 P86 R5
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 37.6
; LAYER_HEIGHT: 0.199997
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 188/200
; update layer progress
M73 L188
M991 S0 P187 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z37.8 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z37.8
G1 Z37.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
M73 P86 R4
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z38 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z37.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 37.8
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 189/200
; update layer progress
M73 L189
M991 S0 P188 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z38 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z38
G1 Z37.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z38.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z37.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 38
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 190/200
; update layer progress
M73 L190
M991 S0 P189 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z38.2 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z38.2
G1 Z38
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
M73 P87 R4
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z38.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z38
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 38.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 191/200
; update layer progress
M73 L191
M991 S0 P190 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z38.4 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z38.4
G1 Z38.2
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z38.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z38.2
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 38.4
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 192/200
; update layer progress
M73 L192
M991 S0 P191 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z38.6 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z38.6
G1 Z38.4
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z38.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z38.4
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
M73 P88 R4
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 38.6
; LAYER_HEIGHT: 0.199997
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 193/200
; update layer progress
M73 L193
M991 S0 P192 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z38.8 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z38.8
G1 Z38.6
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7964
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7964
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7964
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z39 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.643 Y72.986
G1 Z38.6
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7964
M204 S6000
G1 X108.643 Y71.357 E.05401
G1 X71.357 Y108.643 E1.74913
G1 X71.357 Y102.061 E.21832
G1 X77.939 Y108.643 E.30875
G1 X79.033 Y108.643 E.03631
G1 X108.643 Y79.033 E1.38903
G1 X108.643 Y77.939 E.03631
G1 X102.061 Y71.357 E.30875
G1 X100.967 Y71.357 E.03631
G1 X71.357 Y100.967 E1.38903
G1 X71.357 Y94.385 E.21832
G1 X85.615 Y108.643 E.66884
G1 X86.709 Y108.643 E.03631
G1 X108.643 Y86.709 E1.02894
G1 X108.643 Y85.615 E.03631
G1 X94.385 Y71.357 E.66884
G1 X93.291 Y71.357 E.03631
G1 X71.357 Y93.291 E1.02894
G1 X71.357 Y86.709 E.21832
G1 X93.291 Y108.643 E1.02894
G1 X94.385 Y108.643 E.03631
G1 X108.643 Y94.385 E.66884
G1 X108.643 Y93.291 E.03631
G1 X86.709 Y71.357 E1.02894
G1 X85.615 Y71.357 E.03631
G1 X71.357 Y85.615 E.66884
G1 X71.357 Y79.033 E.21832
G1 X100.967 Y108.643 E1.38903
G1 X102.061 Y108.643 E.03631
G1 X108.643 Y102.061 E.30875
G1 X108.643 Y100.967 E.03631
G1 X79.033 Y71.357 E1.38903
G1 X77.939 Y71.357 E.03631
G1 X71.357 Y77.939 E.30875
G1 X71.357 Y71.357 E.21832
G1 X108.643 Y108.643 E1.74913
G1 X107.014 Y108.643 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 38.8
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y108.643 E-.61876
G1 X108.38 Y108.38 E-.14124
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 194/200
; update layer progress
M73 L194
M991 S0 P193 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z39 I-.861 J.861 P1  F42000
G1 X108.991 Y108.991 Z39
G1 Z38.8
G1 E.8 F1800
; FEATURE: Inner wall
G1 F7860
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F7860
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F7860
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
G1 F9547.055
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z39.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.014 Y108.643
G1 Z38.8
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F7860
M204 S6000
G1 X108.643 Y108.643 E.05401
G1 X71.357 Y71.357 E1.74913
G1 X71.357 Y77.939 E.21832
G1 X77.939 Y71.357 E.30875
G1 X79.033 Y71.357 E.03631
G1 X108.643 Y100.967 E1.38903
G1 X108.643 Y102.061 E.03631
G1 X102.061 Y108.643 E.30875
M73 P88 R3
G1 X100.967 Y108.643 E.03631
G1 X71.357 Y79.033 E1.38903
G1 X71.357 Y85.615 E.21832
G1 X85.615 Y71.357 E.66884
G1 X86.709 Y71.357 E.03631
G1 X108.643 Y93.291 E1.02894
G1 X108.643 Y94.385 E.03631
G1 X94.385 Y108.643 E.66884
G1 X93.291 Y108.643 E.03631
G1 X71.357 Y86.709 E1.02894
G1 X71.357 Y93.291 E.21832
G1 X93.291 Y71.357 E1.02894
G1 X94.385 Y71.357 E.03631
G1 X108.643 Y85.615 E.66884
G1 X108.643 Y86.709 E.03631
G1 X86.709 Y108.643 E1.02894
G1 X85.615 Y108.643 E.03631
G1 X71.357 Y94.385 E.66884
G1 X71.357 Y100.967 E.21832
G1 X100.967 Y71.357 E1.38903
G1 X102.061 Y71.357 E.03631
G1 X108.643 Y77.939 E.30875
M73 P89 R3
G1 X108.643 Y79.033 E.03631
G1 X79.033 Y108.643 E1.38903
G1 X77.939 Y108.643 E.03631
G1 X71.357 Y102.061 E.30875
G1 X71.357 Y108.643 E.21832
G1 X108.643 Y71.357 E1.74913
G1 X108.643 Y72.986 E.05401
; CHANGE_LAYER
; Z_HEIGHT: 39
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F8843.478
G1 X108.643 Y71.357 E-.61875
G1 X108.38 Y71.62 E-.14125
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 195/200
; update layer progress
M73 L195
M991 S0 P194 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z39.2 I-1.217 J.02 P1  F42000
G1 X108.991 Y108.991 Z39.2
G1 Z39
G1 E.8 F1800
; FEATURE: Inner wall
G1 F8843.478
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F8843.478
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F9547.055
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z39.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.265 Y73.363
G1 Z39
G1 E.8 F1800
; FEATURE: Sparse infill
; LINE_WIDTH: 0.45
G1 F8843.478
M204 S6000
G1 X108.265 Y71.735 E.05401
G1 X71.735 Y108.265 E1.71374
G1 X71.735 Y102.438 E.19329
G1 X77.562 Y108.265 E.27336
G1 X79.411 Y108.265 E.06133
G1 X108.265 Y79.411 E1.35364
G1 X108.265 Y77.562 E.06133
G1 X102.438 Y71.735 E.27336
G1 X100.589 Y71.735 E.06133
G1 X71.735 Y100.589 E1.35364
G1 X71.735 Y94.762 E.19329
G1 X85.238 Y108.265 E.63345
G1 X87.086 Y108.265 E.06133
G1 X108.265 Y87.086 E.99355
G1 X108.265 Y85.238 E.06133
G1 X94.762 Y71.735 E.63345
G1 X92.914 Y71.735 E.06133
G1 X71.735 Y92.914 E.99355
G1 X71.735 Y87.086 E.19329
G1 X92.914 Y108.265 E.99355
G1 X94.762 Y108.265 E.06133
G1 X108.265 Y94.762 E.63346
G1 X108.265 Y92.914 E.06133
G1 X87.086 Y71.735 E.99355
G1 X85.238 Y71.735 E.06133
G1 X71.735 Y85.238 E.63345
G1 X71.735 Y79.411 E.19329
G1 X100.59 Y108.265 E1.35364
G1 X102.438 Y108.265 E.06133
G1 X108.265 Y102.438 E.27336
G1 X108.265 Y100.59 E.06133
G1 X79.411 Y71.735 E1.35364
G1 X77.562 Y71.735 E.06133
G1 X71.735 Y77.562 E.27336
G1 X71.735 Y71.735 E.19329
G1 X108.265 Y108.265 E1.71374
G1 X106.637 Y108.265 E.05401
M204 S10000
G1 X108.601 Y71.399 F42000
; FEATURE: Floating vertical shell
; LINE_WIDTH: 0.383033
G1 F9955
M204 S6000
G1 X108.469 Y71.372 E.00373
G1 X71.531 Y71.372 E1.02373
G1 X71.399 Y71.399 E.00373
G1 X71.372 Y71.531 E.00373
G1 X71.372 Y108.469 E1.02373
G1 X71.399 Y108.601 E.00373
G1 X71.531 Y108.628 E.00373
G1 X108.469 Y108.628 E1.02373
G1 X108.601 Y108.601 E.00373
G1 X108.628 Y108.469 E.00373
G1 X108.628 Y71.531 E1.02373
G1 X108.613 Y71.458 E.00207
; CHANGE_LAYER
; Z_HEIGHT: 39.2
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F10584.724
G1 X108.628 Y71.531 E-.02837
G1 X108.628 Y73.456 E-.73163
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 196/200
; update layer progress
M73 L196
M991 S0 P195 ;notify layer change
M106 S160.65
; OBJECT_ID: 15
M204 S10000
G17
G3 Z39.4 I-1.217 J.012 P1  F42000
G1 X108.991 Y108.991 Z39.4
G1 Z39.2
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F8843.478
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F8843.478
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F9547.055
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z39.6 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X107.91 Y108.824
G1 Z39.2
G1 E.8 F1800
; FEATURE: Bridge
; LINE_WIDTH: 0.40173
; LAYER_HEIGHT: 0.4
M106 S255
G1 F3000
M204 S6000
G1 X108.621 Y108.113 E.05192
G1 X108.621 Y107.474 E.03299
G1 X107.474 Y108.621 E.08378
G1 X106.835 Y108.621 E.03299
G1 X108.621 Y106.835 E.13044
G1 X108.621 Y106.196 E.03299
G1 X106.196 Y108.621 E.1771
G1 X105.557 Y108.621 E.03299
G1 X108.621 Y105.557 E.22376
G1 X108.621 Y104.919 E.03299
G1 X104.919 Y108.621 E.27042
G1 X104.28 Y108.621 E.03299
G1 X108.621 Y104.28 E.31707
G1 X108.621 Y103.641 E.03299
G1 X103.641 Y108.621 E.36373
G1 X103.002 Y108.621 E.03299
G1 X108.621 Y103.002 E.41039
G1 X108.621 Y102.363 E.03299
G1 X102.363 Y108.621 E.45705
G1 X101.724 Y108.621 E.03299
G1 X108.621 Y101.724 E.50371
G1 X108.621 Y101.086 E.03299
G1 X101.086 Y108.621 E.55037
G1 X100.447 Y108.621 E.03299
G1 X108.621 Y100.447 E.59702
G1 X108.621 Y99.808 E.03299
G1 X99.808 Y108.621 E.64368
G1 X99.169 Y108.621 E.03299
G1 X108.621 Y99.169 E.69034
G1 X108.621 Y98.53 E.03299
G1 X98.53 Y108.621 E.737
G1 X97.891 Y108.621 E.03299
G1 X108.621 Y97.891 E.78366
G1 X108.621 Y97.253 E.03299
G1 X97.252 Y108.621 E.83031
G1 X96.614 Y108.621 E.03299
G1 X108.621 Y96.614 E.87697
G1 X108.621 Y95.975 E.03299
G1 X95.975 Y108.621 E.92363
G1 X95.336 Y108.621 E.03299
G1 X108.621 Y95.336 E.97029
G1 X108.621 Y94.697 E.03299
G1 X94.697 Y108.621 E1.01695
G1 X94.058 Y108.621 E.03299
G1 X108.621 Y94.058 E1.0636
G1 X108.621 Y93.419 E.03299
G1 X93.419 Y108.621 E1.11026
G1 X92.781 Y108.621 E.03299
G1 X108.621 Y92.781 E1.15692
G1 X108.621 Y92.142 E.03299
G1 X92.142 Y108.621 E1.20358
G1 X91.503 Y108.621 E.03299
G1 X108.621 Y91.503 E1.25024
M73 P90 R3
G1 X108.621 Y90.864 E.03299
G1 X90.864 Y108.621 E1.2969
G1 X90.225 Y108.621 E.03299
G1 X108.621 Y90.225 E1.34355
G1 X108.621 Y89.586 E.03299
G1 X89.586 Y108.621 E1.39021
G1 X88.948 Y108.621 E.03299
G1 X108.621 Y88.948 E1.43687
G1 X108.621 Y88.309 E.03299
G1 X88.309 Y108.621 E1.48353
G1 X87.67 Y108.621 E.03299
G1 X108.621 Y87.67 E1.53019
G1 X108.621 Y87.031 E.03299
G1 X87.031 Y108.621 E1.57684
G1 X86.392 Y108.621 E.03299
G1 X108.621 Y86.392 E1.6235
G1 X108.621 Y85.753 E.03299
G1 X85.753 Y108.621 E1.67016
G1 X85.114 Y108.621 E.03299
G1 X108.621 Y85.114 E1.71682
G1 X108.621 Y84.476 E.03299
G1 X84.476 Y108.621 E1.76348
G1 X83.837 Y108.621 E.03299
G1 X108.621 Y83.837 E1.81014
G1 X108.621 Y83.198 E.03299
G1 X83.198 Y108.621 E1.85679
G1 X82.559 Y108.621 E.03299
G1 X108.621 Y82.559 E1.90345
G1 X108.621 Y81.92 E.03299
G1 X81.92 Y108.621 E1.95011
G1 X81.281 Y108.621 E.03299
G1 X108.621 Y81.281 E1.99677
G1 X108.621 Y80.643 E.03299
G1 X80.643 Y108.621 E2.04343
G1 X80.004 Y108.621 E.03299
G1 X108.621 Y80.004 E2.09008
G1 X108.621 Y79.365 E.03299
G1 X79.365 Y108.621 E2.13674
G1 X78.726 Y108.621 E.03299
G1 X108.621 Y78.726 E2.1834
G1 X108.621 Y78.087 E.03299
G1 X78.087 Y108.621 E2.23006
G1 X77.448 Y108.621 E.03299
G1 X108.621 Y77.448 E2.27672
G1 X108.621 Y76.81 E.03299
G1 X76.81 Y108.621 E2.32338
G1 X76.171 Y108.621 E.03299
G1 X108.621 Y76.171 E2.37003
G1 X108.621 Y75.532 E.03299
G1 X75.532 Y108.621 E2.41669
G1 X74.893 Y108.621 E.03299
G1 X108.621 Y74.893 E2.46335
G1 X108.621 Y74.254 E.03299
G1 X74.254 Y108.621 E2.51001
G1 X73.615 Y108.621 E.03299
G1 X108.621 Y73.615 E2.55667
G1 X108.621 Y72.976 E.03299
G1 X72.976 Y108.621 E2.60332
M73 P91 R3
G1 X72.338 Y108.621 E.03299
G1 X108.621 Y72.338 E2.64998
G1 X108.621 Y71.699 E.03299
G1 X71.699 Y108.621 E2.69664
G1 X71.379 Y108.621 E.01652
G1 X71.379 Y108.302 E.01647
G1 X108.302 Y71.379 E2.69671
G1 X107.663 Y71.379 E.03299
G1 X71.379 Y107.663 E2.65005
G1 X71.379 Y107.025 E.03299
G1 X107.025 Y71.379 E2.6034
G1 X106.386 Y71.379 E.03299
G1 X71.379 Y106.386 E2.55674
G1 X71.379 Y105.747 E.03299
G1 X105.747 Y71.379 E2.51008
G1 X105.108 Y71.379 E.03299
G1 X71.379 Y105.108 E2.46342
G1 X71.379 Y104.469 E.03299
G1 X104.469 Y71.379 E2.41676
G1 X103.83 Y71.379 E.03299
G1 X71.379 Y103.83 E2.37011
G1 X71.379 Y103.191 E.03299
G1 X103.191 Y71.379 E2.32345
G1 X102.553 Y71.379 E.03299
G1 X71.379 Y102.553 E2.27679
G1 X71.379 Y101.914 E.03299
G1 X101.914 Y71.379 E2.23013
G1 X101.275 Y71.379 E.03299
G1 X71.379 Y101.275 E2.18347
M73 P91 R2
G1 X71.379 Y100.636 E.03299
G1 X100.636 Y71.379 E2.13682
G1 X99.997 Y71.379 E.03299
G1 X71.379 Y99.997 E2.09016
G1 X71.379 Y99.358 E.03299
G1 X99.358 Y71.379 E2.0435
G1 X98.72 Y71.379 E.03299
G1 X71.379 Y98.72 E1.99684
G1 X71.379 Y98.081 E.03299
G1 X98.081 Y71.379 E1.95018
G1 X97.442 Y71.379 E.03299
G1 X71.379 Y97.442 E1.90352
G1 X71.379 Y96.803 E.03299
G1 X96.803 Y71.379 E1.85687
G1 X96.164 Y71.379 E.03299
G1 X71.379 Y96.164 E1.81021
G1 X71.379 Y95.525 E.03299
G1 X95.525 Y71.379 E1.76355
M73 P92 R2
G1 X94.887 Y71.379 E.03299
G1 X71.379 Y94.887 E1.71689
G1 X71.379 Y94.248 E.03299
G1 X94.248 Y71.379 E1.67023
G1 X93.609 Y71.379 E.03299
G1 X71.379 Y93.609 E1.62358
G1 X71.379 Y92.97 E.03299
G1 X92.97 Y71.379 E1.57692
G1 X92.331 Y71.379 E.03299
G1 X71.379 Y92.331 E1.53026
G1 X71.379 Y91.692 E.03299
G1 X91.692 Y71.379 E1.4836
G1 X91.053 Y71.379 E.03299
G1 X71.379 Y91.053 E1.43694
G1 X71.379 Y90.415 E.03299
G1 X90.415 Y71.379 E1.39028
G1 X89.776 Y71.379 E.03299
G1 X71.379 Y89.776 E1.34363
G1 X71.379 Y89.137 E.03299
G1 X89.137 Y71.379 E1.29697
G1 X88.498 Y71.379 E.03299
G1 X71.379 Y88.498 E1.25031
G1 X71.379 Y87.859 E.03299
G1 X87.859 Y71.379 E1.20365
G1 X87.22 Y71.379 E.03299
G1 X71.379 Y87.22 E1.15699
G1 X71.379 Y86.582 E.03299
G1 X86.582 Y71.379 E1.11034
G1 X85.943 Y71.379 E.03299
G1 X71.379 Y85.943 E1.06368
G1 X71.379 Y85.304 E.03299
G1 X85.304 Y71.379 E1.01702
G1 X84.665 Y71.379 E.03299
G1 X71.379 Y84.665 E.97036
G1 X71.379 Y84.026 E.03299
G1 X84.026 Y71.379 E.9237
G1 X83.387 Y71.379 E.03299
G1 X71.379 Y83.387 E.87704
G1 X71.379 Y82.749 E.03299
G1 X82.749 Y71.379 E.83039
G1 X82.11 Y71.379 E.03299
G1 X71.379 Y82.11 E.78373
G1 X71.379 Y81.471 E.03299
G1 X81.471 Y71.379 E.73707
G1 X80.832 Y71.379 E.03299
G1 X71.379 Y80.832 E.69041
G1 X71.379 Y80.193 E.03299
G1 X80.193 Y71.379 E.64375
G1 X79.554 Y71.379 E.03299
G1 X71.379 Y79.554 E.5971
G1 X71.379 Y78.915 E.03299
G1 X78.915 Y71.379 E.55044
G1 X78.277 Y71.379 E.03299
G1 X71.379 Y78.277 E.50378
G1 X71.379 Y77.638 E.03299
G1 X77.638 Y71.379 E.45712
G1 X76.999 Y71.379 E.03299
G1 X71.379 Y76.999 E.41046
G1 X71.379 Y76.36 E.03299
G1 X76.36 Y71.379 E.3638
G1 X75.721 Y71.379 E.03299
G1 X71.379 Y75.721 E.31715
G1 X71.379 Y75.082 E.03299
G1 X75.082 Y71.379 E.27049
G1 X74.444 Y71.379 E.03299
G1 X71.379 Y74.444 E.22383
G1 X71.379 Y73.805 E.03299
G1 X73.805 Y71.379 E.17717
G1 X73.166 Y71.379 E.03299
G1 X71.379 Y73.166 E.13051
G1 X71.379 Y72.527 E.03299
G1 X72.527 Y71.379 E.08386
G1 X71.888 Y71.379 E.03299
G1 X71.176 Y72.091 E.05199
M106 S160.65
; CHANGE_LAYER
; Z_HEIGHT: 39.4
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F3000
G1 X71.888 Y71.379 E-.38253
G1 X72.527 Y71.379 E-.24276
G1 X72.276 Y71.63 E-.13471
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 197/200
; update layer progress
M73 L197
M991 S0 P196 ;notify layer change
M106 S188.7
; OBJECT_ID: 15
M204 S10000
G17
G3 Z39.6 I-.868 J.853 P1  F42000
G1 X108.991 Y108.991 Z39.6
G1 Z39.4
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F8843.478
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F8843.478
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F9547.055
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z39.8 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X71.173 Y108.061
G1 Z39.4
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42096
G1 F9522.802
M204 S6000
G1 X71.769 Y108.658 E.02598
G1 X72.304 Y108.658 E.01647
G1 X71.342 Y107.696 E.04188
G1 X71.342 Y107.162 E.01647
G1 X72.838 Y108.658 E.06517
G1 X73.373 Y108.658 E.01647
G1 X71.342 Y106.627 E.08846
G1 X71.342 Y106.092 E.01647
G1 X73.908 Y108.658 E.11175
G1 X74.442 Y108.658 E.01647
G1 X71.342 Y105.558 E.13504
G1 X71.342 Y105.023 E.01647
G1 X74.977 Y108.658 E.15834
G1 X75.511 Y108.658 E.01647
G1 X71.342 Y104.489 E.18163
G1 X71.342 Y103.954 E.01647
G1 X76.046 Y108.658 E.20492
G1 X76.581 Y108.658 E.01647
G1 X71.342 Y103.419 E.22821
G1 X71.342 Y102.885 E.01647
G1 X77.115 Y108.658 E.2515
G1 X77.65 Y108.658 E.01647
G1 X71.342 Y102.35 E.27479
G1 X71.342 Y101.815 E.01647
G1 X78.185 Y108.658 E.29808
G1 X78.719 Y108.658 E.01647
G1 X71.342 Y101.281 E.32138
G1 X71.342 Y100.746 E.01647
G1 X79.254 Y108.658 E.34467
G1 X79.788 Y108.658 E.01647
G1 X71.342 Y100.212 E.36796
G1 X71.342 Y99.677 E.01647
G1 X80.323 Y108.658 E.39125
G1 X80.858 Y108.658 E.01647
G1 X71.342 Y99.142 E.41454
G1 X71.342 Y98.608 E.01647
G1 X81.392 Y108.658 E.43783
G1 X81.927 Y108.658 E.01647
G1 X71.342 Y98.073 E.46112
G1 X71.342 Y97.538 E.01647
G1 X82.462 Y108.658 E.48442
G1 X82.996 Y108.658 E.01647
G1 X71.342 Y97.004 E.50771
G1 X71.342 Y96.469 E.01647
G1 X83.531 Y108.658 E.531
G1 X84.066 Y108.658 E.01647
G1 X71.342 Y95.934 E.55429
G1 X71.342 Y95.4 E.01647
G1 X84.6 Y108.658 E.57758
G1 X85.135 Y108.658 E.01647
G1 X71.342 Y94.865 E.60087
G1 X71.342 Y94.331 E.01647
G1 X85.669 Y108.658 E.62416
G1 X86.204 Y108.658 E.01647
G1 X71.342 Y93.796 E.64746
G1 X71.342 Y93.261 E.01647
G1 X86.739 Y108.658 E.67075
G1 X87.273 Y108.658 E.01647
G1 X71.342 Y92.727 E.69404
M73 P93 R2
G1 X71.342 Y92.192 E.01647
G1 X87.808 Y108.658 E.71733
G1 X88.343 Y108.658 E.01647
G1 X71.342 Y91.657 E.74062
G1 X71.342 Y91.123 E.01647
G1 X88.877 Y108.658 E.76391
G1 X89.412 Y108.658 E.01647
G1 X71.342 Y90.588 E.7872
G1 X71.342 Y90.054 E.01647
G1 X89.946 Y108.658 E.8105
G1 X90.481 Y108.658 E.01647
G1 X71.342 Y89.519 E.83379
G1 X71.342 Y88.984 E.01647
G1 X91.016 Y108.658 E.85708
G1 X91.55 Y108.658 E.01647
G1 X71.342 Y88.45 E.88037
G1 X71.342 Y87.915 E.01647
G1 X92.085 Y108.658 E.90366
G1 X92.62 Y108.658 E.01647
G1 X71.342 Y87.38 E.92695
G1 X71.342 Y86.846 E.01647
G1 X93.154 Y108.658 E.95024
G1 X93.689 Y108.658 E.01647
G1 X71.342 Y86.311 E.97353
G1 X71.342 Y85.777 E.01647
G1 X94.223 Y108.658 E.99683
G1 X94.758 Y108.658 E.01647
G1 X71.342 Y85.242 E1.02012
G1 X71.342 Y84.707 E.01647
G1 X95.293 Y108.658 E1.04341
G1 X95.827 Y108.658 E.01647
G1 X71.342 Y84.173 E1.0667
G1 X71.342 Y83.638 E.01647
G1 X96.362 Y108.658 E1.08999
G1 X96.897 Y108.658 E.01647
G1 X71.342 Y83.103 E1.11328
G1 X71.342 Y82.569 E.01647
G1 X97.431 Y108.658 E1.13657
G1 X97.966 Y108.658 E.01647
G1 X71.342 Y82.034 E1.15987
G1 X71.342 Y81.5 E.01647
G1 X98.501 Y108.658 E1.18316
G1 X99.035 Y108.658 E.01647
G1 X71.342 Y80.965 E1.20645
G1 X71.342 Y80.43 E.01647
G1 X99.57 Y108.658 E1.22974
G1 X100.104 Y108.658 E.01647
G1 X71.342 Y79.896 E1.25303
G1 X71.342 Y79.361 E.01647
G1 X100.639 Y108.658 E1.27632
G1 X101.174 Y108.658 E.01647
G1 X71.342 Y78.826 E1.29961
G1 X71.342 Y78.292 E.01647
G1 X101.708 Y108.658 E1.32291
G1 X102.243 Y108.658 E.01647
G1 X71.342 Y77.757 E1.3462
G1 X71.342 Y77.222 E.01647
G1 X102.778 Y108.658 E1.36949
G1 X103.312 Y108.658 E.01647
G1 X71.342 Y76.688 E1.39278
G1 X71.342 Y76.153 E.01647
G1 X103.847 Y108.658 E1.41607
G1 X104.381 Y108.658 E.01647
G1 X71.342 Y75.619 E1.43936
G1 X71.342 Y75.084 E.01647
G1 X104.916 Y108.658 E1.46265
G1 X105.451 Y108.658 E.01647
G1 X71.342 Y74.549 E1.48595
G1 X71.342 Y74.015 E.01647
G1 X105.985 Y108.658 E1.50924
G1 X106.52 Y108.658 E.01647
G1 X71.342 Y73.48 E1.53253
G1 X71.342 Y72.945 E.01647
G1 X107.055 Y108.658 E1.55582
G1 X107.589 Y108.658 E.01647
G1 X71.342 Y72.411 E1.57911
G1 X71.342 Y71.876 E.01647
G1 X108.124 Y108.658 E1.6024
G1 X108.658 Y108.658 E.01644
G1 X71.343 Y71.342 E1.62564
G1 X71.878 Y71.342 E.01647
G1 X108.658 Y108.122 E1.60233
G1 X108.658 Y107.588 E.01647
G1 X72.413 Y71.342 E1.57904
G1 X72.947 Y71.342 E.01647
G1 X108.658 Y107.053 E1.55575
G1 X108.658 Y106.518 E.01647
G1 X73.482 Y71.342 E1.53245
G1 X74.016 Y71.342 E.01647
G1 X108.658 Y105.984 E1.50916
G1 X108.658 Y105.449 E.01647
G1 X74.551 Y71.342 E1.48587
G1 X75.086 Y71.342 E.01647
G1 X108.658 Y104.914 E1.46258
G1 X108.658 Y104.38 E.01647
G1 X75.62 Y71.342 E1.43929
G1 X76.155 Y71.342 E.01647
G1 X108.658 Y103.845 E1.416
G1 X108.658 Y103.31 E.01647
G1 X76.69 Y71.342 E1.39271
G1 X77.224 Y71.342 E.01647
G1 X108.658 Y102.776 E1.36941
G1 X108.658 Y102.241 E.01647
G1 X77.759 Y71.342 E1.34612
G1 X78.293 Y71.342 E.01647
G1 X108.658 Y101.707 E1.32283
G1 X108.658 Y101.172 E.01647
G1 X78.828 Y71.342 E1.29954
G1 X79.363 Y71.342 E.01647
G1 X108.658 Y100.637 E1.27625
G1 X108.658 Y100.103 E.01647
G1 X79.897 Y71.342 E1.25296
G1 X80.432 Y71.342 E.01647
G1 X108.658 Y99.568 E1.22967
G1 X108.658 Y99.033 E.01647
G1 X80.967 Y71.342 E1.20637
G1 X81.501 Y71.342 E.01647
G1 X108.658 Y98.499 E1.18308
G1 X108.658 Y97.964 E.01647
G1 X82.036 Y71.342 E1.15979
G1 X82.57 Y71.342 E.01647
G1 X108.658 Y97.43 E1.1365
G1 X108.658 Y96.895 E.01647
G1 X83.105 Y71.342 E1.11321
G1 X83.64 Y71.342 E.01647
G1 X108.658 Y96.36 E1.08992
G1 X108.658 Y95.826 E.01647
G1 X84.174 Y71.342 E1.06663
G1 X84.709 Y71.342 E.01647
G1 X108.658 Y95.291 E1.04333
G1 X108.658 Y94.756 E.01647
G1 X85.244 Y71.342 E1.02004
G1 X85.778 Y71.342 E.01647
G1 X108.658 Y94.222 E.99675
G1 X108.658 Y93.687 E.01647
G1 X86.313 Y71.342 E.97346
G1 X86.848 Y71.342 E.01647
G1 X108.658 Y93.153 E.95017
G1 X108.658 Y92.618 E.01647
G1 X87.382 Y71.342 E.92688
G1 X87.917 Y71.342 E.01647
G1 X108.658 Y92.083 E.90359
G1 X108.658 Y91.549 E.01647
G1 X88.451 Y71.342 E.88029
G1 X88.986 Y71.342 E.01647
G1 X108.658 Y91.014 E.857
G1 X108.658 Y90.479 E.01647
G1 X89.521 Y71.342 E.83371
G1 X90.055 Y71.342 E.01647
G1 X108.658 Y89.945 E.81042
G1 X108.658 Y89.41 E.01647
G1 X90.59 Y71.342 E.78713
G1 X91.125 Y71.342 E.01647
G1 X108.658 Y88.875 E.76384
M73 P94 R2
G1 X108.658 Y88.341 E.01647
G1 X91.659 Y71.342 E.74055
G1 X92.194 Y71.342 E.01647
G1 X108.658 Y87.806 E.71726
G1 X108.658 Y87.272 E.01647
G1 X92.728 Y71.342 E.69396
G1 X93.263 Y71.342 E.01647
G1 X108.658 Y86.737 E.67067
G1 X108.658 Y86.202 E.01647
G1 X93.798 Y71.342 E.64738
G1 X94.332 Y71.342 E.01647
G1 X108.658 Y85.668 E.62409
G1 X108.658 Y85.133 E.01647
G1 X94.867 Y71.342 E.6008
G1 X95.402 Y71.342 E.01647
G1 X108.658 Y84.598 E.57751
G1 X108.658 Y84.064 E.01647
G1 X95.936 Y71.342 E.55422
G1 X96.471 Y71.342 E.01647
G1 X108.658 Y83.529 E.53092
G1 X108.658 Y82.995 E.01647
G1 X97.005 Y71.342 E.50763
G1 X97.54 Y71.342 E.01647
G1 X108.658 Y82.46 E.48434
G1 X108.658 Y81.925 E.01647
G1 X98.075 Y71.342 E.46105
G1 X98.609 Y71.342 E.01647
G1 X108.658 Y81.391 E.43776
G1 X108.658 Y80.856 E.01647
G1 X99.144 Y71.342 E.41447
G1 X99.679 Y71.342 E.01647
G1 X108.658 Y80.321 E.39118
G1 X108.658 Y79.787 E.01647
G1 X100.213 Y71.342 E.36788
G1 X100.748 Y71.342 E.01647
G1 X108.658 Y79.252 E.34459
G1 X108.658 Y78.718 E.01647
G1 X101.282 Y71.342 E.3213
G1 X101.817 Y71.342 E.01647
G1 X108.658 Y78.183 E.29801
G1 X108.658 Y77.648 E.01647
G1 X102.352 Y71.342 E.27472
G1 X102.886 Y71.342 E.01647
G1 X108.658 Y77.114 E.25143
G1 X108.658 Y76.579 E.01647
G1 X103.421 Y71.342 E.22814
G1 X103.956 Y71.342 E.01647
G1 X108.658 Y76.044 E.20484
G1 X108.658 Y75.51 E.01647
G1 X104.49 Y71.342 E.18155
G1 X105.025 Y71.342 E.01647
G1 X108.658 Y74.975 E.15826
G1 X108.658 Y74.441 E.01647
G1 X105.56 Y71.342 E.13497
G1 X106.094 Y71.342 E.01647
G1 X108.658 Y73.906 E.11168
G1 X108.658 Y73.371 E.01647
G1 X106.629 Y71.342 E.08839
G1 X107.163 Y71.342 E.01647
G1 X108.658 Y72.837 E.0651
G1 X108.658 Y72.302 E.01647
G1 X107.698 Y71.342 E.04181
G1 X108.233 Y71.342 E.01647
G1 X108.827 Y71.937 E.02591
; CHANGE_LAYER
; Z_HEIGHT: 39.6
; LAYER_HEIGHT: 0.199997
; WIPE_START
G1 F9522.802
G1 X108.233 Y71.342 E-.31956
G1 X107.698 Y71.342 E-.20316
G1 X108.14 Y71.784 E-.23728
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 198/200
; update layer progress
M73 L198
M991 S0 P197 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z39.8 I-1.217 J.028 P1  F42000
G1 X108.991 Y108.991 Z39.8
G1 Z39.6
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F8843.478
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F8843.478
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F9547.055
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z40 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X108.063 Y108.827
G1 Z39.6
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42096
G1 F9522.802
M204 S6000
G1 X108.658 Y108.233 E.02591
G1 X108.658 Y107.698 E.01647
G1 X107.698 Y108.658 E.0418
G1 X107.163 Y108.658 E.01647
G1 X108.658 Y107.163 E.0651
G1 X108.658 Y106.629 E.01647
G1 X106.629 Y108.658 E.08839
G1 X106.094 Y108.658 E.01647
G1 X108.658 Y106.094 E.11168
G1 X108.658 Y105.56 E.01647
G1 X105.56 Y108.658 E.13497
G1 X105.025 Y108.658 E.01647
G1 X108.658 Y105.025 E.15826
G1 X108.658 Y104.49 E.01647
G1 X104.49 Y108.658 E.18155
G1 X103.956 Y108.658 E.01647
G1 X108.658 Y103.956 E.20484
G1 X108.658 Y103.421 E.01647
G1 X103.421 Y108.658 E.22814
G1 X102.886 Y108.658 E.01647
G1 X108.658 Y102.886 E.25143
G1 X108.658 Y102.352 E.01647
G1 X102.352 Y108.658 E.27472
G1 X101.817 Y108.658 E.01647
G1 X108.658 Y101.817 E.29801
G1 X108.658 Y101.282 E.01647
G1 X101.282 Y108.658 E.3213
G1 X100.748 Y108.658 E.01647
G1 X108.658 Y100.748 E.34459
G1 X108.658 Y100.213 E.01647
G1 X100.213 Y108.658 E.36788
G1 X99.679 Y108.658 E.01647
G1 X108.658 Y99.679 E.39118
G1 X108.658 Y99.144 E.01647
G1 X99.144 Y108.658 E.41447
G1 X98.609 Y108.658 E.01647
G1 X108.658 Y98.609 E.43776
M73 P94 R1
G1 X108.658 Y98.075 E.01647
G1 X98.075 Y108.658 E.46105
G1 X97.54 Y108.658 E.01647
G1 X108.658 Y97.54 E.48434
G1 X108.658 Y97.005 E.01647
G1 X97.005 Y108.658 E.50763
G1 X96.471 Y108.658 E.01647
G1 X108.658 Y96.471 E.53092
G1 X108.658 Y95.936 E.01647
G1 X95.936 Y108.658 E.55422
G1 X95.402 Y108.658 E.01647
G1 X108.658 Y95.402 E.57751
G1 X108.658 Y94.867 E.01647
G1 X94.867 Y108.658 E.6008
G1 X94.332 Y108.658 E.01647
G1 X108.658 Y94.332 E.62409
G1 X108.658 Y93.798 E.01647
G1 X93.798 Y108.658 E.64738
G1 X93.263 Y108.658 E.01647
G1 X108.658 Y93.263 E.67067
G1 X108.658 Y92.728 E.01647
G1 X92.728 Y108.658 E.69396
G1 X92.194 Y108.658 E.01647
G1 X108.658 Y92.194 E.71726
G1 X108.658 Y91.659 E.01647
G1 X91.659 Y108.658 E.74055
G1 X91.125 Y108.658 E.01647
G1 X108.658 Y91.125 E.76384
G1 X108.658 Y90.59 E.01647
G1 X90.59 Y108.658 E.78713
G1 X90.055 Y108.658 E.01647
G1 X108.658 Y90.055 E.81042
G1 X108.658 Y89.521 E.01647
G1 X89.521 Y108.658 E.83371
G1 X88.986 Y108.658 E.01647
G1 X108.658 Y88.986 E.857
G1 X108.658 Y88.451 E.01647
G1 X88.451 Y108.658 E.8803
G1 X87.917 Y108.658 E.01647
G1 X108.658 Y87.917 E.90359
G1 X108.658 Y87.382 E.01647
G1 X87.382 Y108.658 E.92688
G1 X86.847 Y108.658 E.01647
G1 X108.658 Y86.847 E.95017
G1 X108.658 Y86.313 E.01647
G1 X86.313 Y108.658 E.97346
G1 X85.778 Y108.658 E.01647
G1 X108.658 Y85.778 E.99675
G1 X108.658 Y85.244 E.01647
G1 X85.244 Y108.658 E1.02004
G1 X84.709 Y108.658 E.01647
G1 X108.658 Y84.709 E1.04334
G1 X108.658 Y84.174 E.01647
G1 X84.174 Y108.658 E1.06663
G1 X83.64 Y108.658 E.01647
G1 X108.658 Y83.64 E1.08992
G1 X108.658 Y83.105 E.01647
G1 X83.105 Y108.658 E1.11321
G1 X82.57 Y108.658 E.01647
G1 X108.658 Y82.57 E1.1365
G1 X108.658 Y82.036 E.01647
G1 X82.036 Y108.658 E1.15979
G1 X81.501 Y108.658 E.01647
G1 X108.658 Y81.501 E1.18308
G1 X108.658 Y80.967 E.01647
G1 X80.967 Y108.658 E1.20638
G1 X80.432 Y108.658 E.01647
G1 X108.658 Y80.432 E1.22967
G1 X108.658 Y79.897 E.01647
G1 X79.897 Y108.658 E1.25296
G1 X79.363 Y108.658 E.01647
G1 X108.658 Y79.363 E1.27625
G1 X108.658 Y78.828 E.01647
G1 X78.828 Y108.658 E1.29954
G1 X78.293 Y108.658 E.01647
G1 X108.658 Y78.293 E1.32283
G1 X108.658 Y77.759 E.01647
G1 X77.759 Y108.658 E1.34612
G1 X77.224 Y108.658 E.01647
G1 X108.658 Y77.224 E1.36942
G1 X108.658 Y76.69 E.01647
G1 X76.69 Y108.658 E1.39271
G1 X76.155 Y108.658 E.01647
G1 X108.658 Y76.155 E1.416
G1 X108.658 Y75.62 E.01647
G1 X75.62 Y108.658 E1.43929
G1 X75.086 Y108.658 E.01647
G1 X108.658 Y75.086 E1.46258
G1 X108.658 Y74.551 E.01647
G1 X74.551 Y108.658 E1.48587
G1 X74.016 Y108.658 E.01647
G1 X108.658 Y74.016 E1.50916
G1 X108.658 Y73.482 E.01647
G1 X73.482 Y108.658 E1.53245
G1 X72.947 Y108.658 E.01647
G1 X108.658 Y72.947 E1.55575
G1 X108.658 Y72.413 E.01647
G1 X72.412 Y108.658 E1.57904
G1 X71.878 Y108.658 E.01647
G1 X108.658 Y71.878 E1.60233
M73 P95 R1
G1 X108.658 Y71.343 E.01647
G1 X71.342 Y108.658 E1.62564
G1 X71.342 Y108.124 E.01644
G1 X108.124 Y71.342 E1.6024
G1 X107.589 Y71.342 E.01647
G1 X71.342 Y107.589 E1.57911
G1 X71.342 Y107.055 E.01647
G1 X107.055 Y71.342 E1.55582
G1 X106.52 Y71.342 E.01647
G1 X71.342 Y106.52 E1.53253
G1 X71.342 Y105.985 E.01647
G1 X105.985 Y71.342 E1.50924
G1 X105.451 Y71.342 E.01647
G1 X71.342 Y105.451 E1.48595
G1 X71.342 Y104.916 E.01647
G1 X104.916 Y71.342 E1.46265
G1 X104.381 Y71.342 E.01647
G1 X71.342 Y104.381 E1.43936
G1 X71.342 Y103.847 E.01647
G1 X103.847 Y71.342 E1.41607
G1 X103.312 Y71.342 E.01647
G1 X71.342 Y103.312 E1.39278
G1 X71.342 Y102.778 E.01647
G1 X102.778 Y71.342 E1.36949
G1 X102.243 Y71.342 E.01647
G1 X71.342 Y102.243 E1.3462
G1 X71.342 Y101.708 E.01647
G1 X101.708 Y71.342 E1.32291
G1 X101.174 Y71.342 E.01647
G1 X71.342 Y101.174 E1.29961
G1 X71.342 Y100.639 E.01647
G1 X100.639 Y71.342 E1.27632
G1 X100.104 Y71.342 E.01647
G1 X71.342 Y100.104 E1.25303
G1 X71.342 Y99.57 E.01647
G1 X99.57 Y71.342 E1.22974
G1 X99.035 Y71.342 E.01647
G1 X71.342 Y99.035 E1.20645
G1 X71.342 Y98.501 E.01647
G1 X98.501 Y71.342 E1.18316
G1 X97.966 Y71.342 E.01647
G1 X71.342 Y97.966 E1.15987
G1 X71.342 Y97.431 E.01647
G1 X97.431 Y71.342 E1.13657
G1 X96.897 Y71.342 E.01647
G1 X71.342 Y96.897 E1.11328
G1 X71.342 Y96.362 E.01647
G1 X96.362 Y71.342 E1.08999
G1 X95.827 Y71.342 E.01647
G1 X71.342 Y95.827 E1.0667
G1 X71.342 Y95.293 E.01647
G1 X95.293 Y71.342 E1.04341
G1 X94.758 Y71.342 E.01647
G1 X71.342 Y94.758 E1.02012
G1 X71.342 Y94.223 E.01647
G1 X94.223 Y71.342 E.99683
G1 X93.689 Y71.342 E.01647
G1 X71.342 Y93.689 E.97353
G1 X71.342 Y93.154 E.01647
G1 X93.154 Y71.342 E.95024
G1 X92.62 Y71.342 E.01647
G1 X71.342 Y92.62 E.92695
G1 X71.342 Y92.085 E.01647
G1 X92.085 Y71.342 E.90366
G1 X91.55 Y71.342 E.01647
G1 X71.342 Y91.55 E.88037
G1 X71.342 Y91.016 E.01647
G1 X91.016 Y71.342 E.85708
G1 X90.481 Y71.342 E.01647
G1 X71.342 Y90.481 E.83379
G1 X71.342 Y89.946 E.01647
G1 X89.946 Y71.342 E.81049
G1 X89.412 Y71.342 E.01647
G1 X71.342 Y89.412 E.7872
G1 X71.342 Y88.877 E.01647
G1 X88.877 Y71.342 E.76391
G1 X88.343 Y71.342 E.01647
G1 X71.342 Y88.343 E.74062
G1 X71.342 Y87.808 E.01647
G1 X87.808 Y71.342 E.71733
G1 X87.273 Y71.342 E.01647
G1 X71.342 Y87.273 E.69404
G1 X71.342 Y86.739 E.01647
G1 X86.739 Y71.342 E.67075
G1 X86.204 Y71.342 E.01647
G1 X71.342 Y86.204 E.64745
G1 X71.342 Y85.669 E.01647
G1 X85.669 Y71.342 E.62416
G1 X85.135 Y71.342 E.01647
G1 X71.342 Y85.135 E.60087
G1 X71.342 Y84.6 E.01647
G1 X84.6 Y71.342 E.57758
G1 X84.066 Y71.342 E.01647
G1 X71.342 Y84.066 E.55429
G1 X71.342 Y83.531 E.01647
G1 X83.531 Y71.342 E.531
G1 X82.996 Y71.342 E.01647
G1 X71.342 Y82.996 E.50771
G1 X71.342 Y82.462 E.01647
G1 X82.462 Y71.342 E.48441
G1 X81.927 Y71.342 E.01647
G1 X71.342 Y81.927 E.46112
G1 X71.342 Y81.392 E.01647
G1 X81.392 Y71.342 E.43783
G1 X80.858 Y71.342 E.01647
G1 X71.342 Y80.858 E.41454
G1 X71.342 Y80.323 E.01647
G1 X80.323 Y71.342 E.39125
G1 X79.788 Y71.342 E.01647
G1 X71.342 Y79.788 E.36796
G1 X71.342 Y79.254 E.01647
G1 X79.254 Y71.342 E.34467
G1 X78.719 Y71.342 E.01647
G1 X71.342 Y78.719 E.32137
G1 X71.342 Y78.185 E.01647
G1 X78.185 Y71.342 E.29808
G1 X77.65 Y71.342 E.01647
G1 X71.342 Y77.65 E.27479
G1 X71.342 Y77.115 E.01647
G1 X77.115 Y71.342 E.2515
G1 X76.581 Y71.342 E.01647
G1 X71.342 Y76.581 E.22821
G1 X71.342 Y76.046 E.01647
G1 X76.046 Y71.342 E.20492
G1 X75.511 Y71.342 E.01647
G1 X71.342 Y75.511 E.18163
G1 X71.342 Y74.977 E.01647
G1 X74.977 Y71.342 E.15834
G1 X74.442 Y71.342 E.01647
G1 X71.342 Y74.442 E.13504
G1 X71.342 Y73.908 E.01647
G1 X73.908 Y71.342 E.11175
G1 X73.373 Y71.342 E.01647
G1 X71.342 Y73.373 E.08846
G1 X71.342 Y72.838 E.01647
G1 X72.838 Y71.342 E.06517
G1 X72.304 Y71.342 E.01647
G1 X71.342 Y72.304 E.04188
G1 X71.342 Y71.769 E.01647
G1 X71.939 Y71.173 E.02598
; CHANGE_LAYER
; Z_HEIGHT: 39.8
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F9522.802
G1 X71.342 Y71.769 E-.32046
G1 X71.342 Y72.304 E-.20316
G1 X71.782 Y71.864 E-.23638
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 199/200
; update layer progress
M73 L199
M991 S0 P198 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z40 I-.86 J.861 P1  F42000
G1 X108.991 Y108.991 Z40
G1 Z39.8
G1 E.8 F1800
; FEATURE: Inner wall
; LINE_WIDTH: 0.45
G1 F8843.478
M204 S6000
G1 X71.009 Y108.991 E1.25992
G1 X71.009 Y71.009 E1.25992
G1 X108.991 Y71.009 E1.25992
G1 X108.991 Y108.931 E1.25793
M204 S10000
G1 X109.398 Y109.398 F42000
G1 F8843.478
M204 S6000
G1 X70.602 Y109.398 E1.28693
G1 X70.602 Y70.602 E1.28693
G1 X109.398 Y70.602 E1.28693
G1 X109.398 Y109.338 E1.28494
M204 S250
G1 X109.79 Y109.79 F42000
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F9547.055
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z40.2 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X71.173 Y108.061
G1 Z39.8
G1 E.8 F1800
; FEATURE: Internal solid infill
; LINE_WIDTH: 0.42096
G1 F9522.802
M204 S6000
G1 X71.769 Y108.658 E.02598
G1 X72.304 Y108.658 E.01647
G1 X71.342 Y107.696 E.04188
G1 X71.342 Y107.162 E.01647
G1 X72.838 Y108.658 E.06517
G1 X73.373 Y108.658 E.01647
G1 X71.342 Y106.627 E.08846
G1 X71.342 Y106.092 E.01647
G1 X73.908 Y108.658 E.11175
G1 X74.442 Y108.658 E.01647
G1 X71.342 Y105.558 E.13504
G1 X71.342 Y105.023 E.01647
G1 X74.977 Y108.658 E.15834
G1 X75.511 Y108.658 E.01647
G1 X71.342 Y104.489 E.18163
G1 X71.342 Y103.954 E.01647
G1 X76.046 Y108.658 E.20492
G1 X76.581 Y108.658 E.01647
G1 X71.342 Y103.419 E.22821
G1 X71.342 Y102.885 E.01647
G1 X77.115 Y108.658 E.2515
G1 X77.65 Y108.658 E.01647
G1 X71.342 Y102.35 E.27479
G1 X71.342 Y101.815 E.01647
G1 X78.185 Y108.658 E.29808
G1 X78.719 Y108.658 E.01647
G1 X71.342 Y101.281 E.32138
G1 X71.342 Y100.746 E.01647
G1 X79.254 Y108.658 E.34467
G1 X79.788 Y108.658 E.01647
G1 X71.342 Y100.212 E.36796
G1 X71.342 Y99.677 E.01647
G1 X80.323 Y108.658 E.39125
G1 X80.858 Y108.658 E.01647
G1 X71.342 Y99.142 E.41454
G1 X71.342 Y98.608 E.01647
G1 X81.392 Y108.658 E.43783
G1 X81.927 Y108.658 E.01647
G1 X71.342 Y98.073 E.46112
G1 X71.342 Y97.538 E.01647
G1 X82.462 Y108.658 E.48442
G1 X82.996 Y108.658 E.01647
G1 X71.342 Y97.004 E.50771
G1 X71.342 Y96.469 E.01647
G1 X83.531 Y108.658 E.531
G1 X84.066 Y108.658 E.01647
G1 X71.342 Y95.934 E.55429
G1 X71.342 Y95.4 E.01647
G1 X84.6 Y108.658 E.57758
M73 P96 R1
G1 X85.135 Y108.658 E.01647
G1 X71.342 Y94.865 E.60087
G1 X71.342 Y94.331 E.01647
G1 X85.669 Y108.658 E.62416
G1 X86.204 Y108.658 E.01647
G1 X71.342 Y93.796 E.64746
G1 X71.342 Y93.261 E.01647
G1 X86.739 Y108.658 E.67075
G1 X87.273 Y108.658 E.01647
G1 X71.342 Y92.727 E.69404
G1 X71.342 Y92.192 E.01647
G1 X87.808 Y108.658 E.71733
G1 X88.343 Y108.658 E.01647
G1 X71.342 Y91.657 E.74062
G1 X71.342 Y91.123 E.01647
G1 X88.877 Y108.658 E.76391
G1 X89.412 Y108.658 E.01647
G1 X71.342 Y90.588 E.7872
G1 X71.342 Y90.054 E.01647
G1 X89.946 Y108.658 E.8105
G1 X90.481 Y108.658 E.01647
G1 X71.342 Y89.519 E.83379
G1 X71.342 Y88.984 E.01647
G1 X91.016 Y108.658 E.85708
G1 X91.55 Y108.658 E.01647
G1 X71.342 Y88.45 E.88037
G1 X71.342 Y87.915 E.01647
G1 X92.085 Y108.658 E.90366
G1 X92.62 Y108.658 E.01647
G1 X71.342 Y87.38 E.92695
G1 X71.342 Y86.846 E.01647
G1 X93.154 Y108.658 E.95024
G1 X93.689 Y108.658 E.01647
G1 X71.342 Y86.311 E.97353
G1 X71.342 Y85.777 E.01647
G1 X94.223 Y108.658 E.99683
G1 X94.758 Y108.658 E.01647
G1 X71.342 Y85.242 E1.02012
G1 X71.342 Y84.707 E.01647
G1 X95.293 Y108.658 E1.04341
G1 X95.827 Y108.658 E.01647
G1 X71.342 Y84.173 E1.0667
G1 X71.342 Y83.638 E.01647
G1 X96.362 Y108.658 E1.08999
G1 X96.897 Y108.658 E.01647
G1 X71.342 Y83.103 E1.11328
G1 X71.342 Y82.569 E.01647
G1 X97.431 Y108.658 E1.13657
G1 X97.966 Y108.658 E.01647
G1 X71.342 Y82.034 E1.15987
G1 X71.342 Y81.5 E.01647
G1 X98.501 Y108.658 E1.18316
G1 X99.035 Y108.658 E.01647
G1 X71.342 Y80.965 E1.20645
G1 X71.342 Y80.43 E.01647
G1 X99.57 Y108.658 E1.22974
G1 X100.104 Y108.658 E.01647
G1 X71.342 Y79.896 E1.25303
G1 X71.342 Y79.361 E.01647
G1 X100.639 Y108.658 E1.27632
G1 X101.174 Y108.658 E.01647
G1 X71.342 Y78.826 E1.29961
G1 X71.342 Y78.292 E.01647
G1 X101.708 Y108.658 E1.32291
G1 X102.243 Y108.658 E.01647
G1 X71.342 Y77.757 E1.3462
G1 X71.342 Y77.222 E.01647
G1 X102.778 Y108.658 E1.36949
G1 X103.312 Y108.658 E.01647
G1 X71.342 Y76.688 E1.39278
G1 X71.342 Y76.153 E.01647
G1 X103.847 Y108.658 E1.41607
G1 X104.381 Y108.658 E.01647
G1 X71.342 Y75.619 E1.43936
G1 X71.342 Y75.084 E.01647
G1 X104.916 Y108.658 E1.46265
G1 X105.451 Y108.658 E.01647
G1 X71.342 Y74.549 E1.48595
G1 X71.342 Y74.015 E.01647
G1 X105.985 Y108.658 E1.50924
G1 X106.52 Y108.658 E.01647
G1 X71.342 Y73.48 E1.53253
G1 X71.342 Y72.945 E.01647
G1 X107.055 Y108.658 E1.55582
G1 X107.589 Y108.658 E.01647
G1 X71.342 Y72.411 E1.57911
G1 X71.342 Y71.876 E.01647
G1 X108.124 Y108.658 E1.6024
G1 X108.658 Y108.658 E.01644
G1 X71.343 Y71.342 E1.62564
G1 X71.878 Y71.342 E.01647
G1 X108.658 Y108.122 E1.60233
G1 X108.658 Y107.588 E.01647
G1 X72.413 Y71.342 E1.57904
G1 X72.947 Y71.342 E.01647
G1 X108.658 Y107.053 E1.55575
G1 X108.658 Y106.518 E.01647
G1 X73.482 Y71.342 E1.53245
G1 X74.016 Y71.342 E.01647
G1 X108.658 Y105.984 E1.50916
G1 X108.658 Y105.449 E.01647
G1 X74.551 Y71.342 E1.48587
G1 X75.086 Y71.342 E.01647
G1 X108.658 Y104.914 E1.46258
G1 X108.658 Y104.38 E.01647
G1 X75.62 Y71.342 E1.43929
G1 X76.155 Y71.342 E.01647
G1 X108.658 Y103.845 E1.416
G1 X108.658 Y103.31 E.01647
G1 X76.69 Y71.342 E1.39271
G1 X77.224 Y71.342 E.01647
G1 X108.658 Y102.776 E1.36941
G1 X108.658 Y102.241 E.01647
G1 X77.759 Y71.342 E1.34612
G1 X78.293 Y71.342 E.01647
G1 X108.658 Y101.707 E1.32283
G1 X108.658 Y101.172 E.01647
G1 X78.828 Y71.342 E1.29954
G1 X79.363 Y71.342 E.01647
G1 X108.658 Y100.637 E1.27625
G1 X108.658 Y100.103 E.01647
G1 X79.897 Y71.342 E1.25296
G1 X80.432 Y71.342 E.01647
G1 X108.658 Y99.568 E1.22967
G1 X108.658 Y99.033 E.01647
G1 X80.967 Y71.342 E1.20637
G1 X81.501 Y71.342 E.01647
G1 X108.658 Y98.499 E1.18308
G1 X108.658 Y97.964 E.01647
G1 X82.036 Y71.342 E1.15979
G1 X82.57 Y71.342 E.01647
G1 X108.658 Y97.43 E1.1365
G1 X108.658 Y96.895 E.01647
G1 X83.105 Y71.342 E1.11321
G1 X83.64 Y71.342 E.01647
G1 X108.658 Y96.36 E1.08992
G1 X108.658 Y95.826 E.01647
G1 X84.174 Y71.342 E1.06663
G1 X84.709 Y71.342 E.01647
G1 X108.658 Y95.291 E1.04333
G1 X108.658 Y94.756 E.01647
G1 X85.244 Y71.342 E1.02004
G1 X85.778 Y71.342 E.01647
G1 X108.658 Y94.222 E.99675
G1 X108.658 Y93.687 E.01647
G1 X86.313 Y71.342 E.97346
G1 X86.848 Y71.342 E.01647
G1 X108.658 Y93.153 E.95017
G1 X108.658 Y92.618 E.01647
G1 X87.382 Y71.342 E.92688
G1 X87.917 Y71.342 E.01647
G1 X108.658 Y92.083 E.90359
G1 X108.658 Y91.549 E.01647
G1 X88.451 Y71.342 E.88029
G1 X88.986 Y71.342 E.01647
G1 X108.658 Y91.014 E.857
M73 P97 R1
G1 X108.658 Y90.479 E.01647
G1 X89.521 Y71.342 E.83371
G1 X90.055 Y71.342 E.01647
G1 X108.658 Y89.945 E.81042
G1 X108.658 Y89.41 E.01647
G1 X90.59 Y71.342 E.78713
G1 X91.125 Y71.342 E.01647
G1 X108.658 Y88.875 E.76384
G1 X108.658 Y88.341 E.01647
G1 X91.659 Y71.342 E.74055
G1 X92.194 Y71.342 E.01647
G1 X108.658 Y87.806 E.71726
G1 X108.658 Y87.272 E.01647
G1 X92.728 Y71.342 E.69396
G1 X93.263 Y71.342 E.01647
G1 X108.658 Y86.737 E.67067
G1 X108.658 Y86.202 E.01647
G1 X93.798 Y71.342 E.64738
G1 X94.332 Y71.342 E.01647
G1 X108.658 Y85.668 E.62409
G1 X108.658 Y85.133 E.01647
G1 X94.867 Y71.342 E.6008
G1 X95.402 Y71.342 E.01647
G1 X108.658 Y84.598 E.57751
G1 X108.658 Y84.064 E.01647
G1 X95.936 Y71.342 E.55422
G1 X96.471 Y71.342 E.01647
G1 X108.658 Y83.529 E.53092
G1 X108.658 Y82.995 E.01647
G1 X97.005 Y71.342 E.50763
G1 X97.54 Y71.342 E.01647
G1 X108.658 Y82.46 E.48434
G1 X108.658 Y81.925 E.01647
G1 X98.075 Y71.342 E.46105
G1 X98.609 Y71.342 E.01647
G1 X108.658 Y81.391 E.43776
G1 X108.658 Y80.856 E.01647
G1 X99.144 Y71.342 E.41447
G1 X99.679 Y71.342 E.01647
G1 X108.658 Y80.321 E.39118
G1 X108.658 Y79.787 E.01647
G1 X100.213 Y71.342 E.36788
G1 X100.748 Y71.342 E.01647
G1 X108.658 Y79.252 E.34459
G1 X108.658 Y78.718 E.01647
G1 X101.282 Y71.342 E.3213
G1 X101.817 Y71.342 E.01647
G1 X108.658 Y78.183 E.29801
G1 X108.658 Y77.648 E.01647
G1 X102.352 Y71.342 E.27472
G1 X102.886 Y71.342 E.01647
G1 X108.658 Y77.114 E.25143
G1 X108.658 Y76.579 E.01647
G1 X103.421 Y71.342 E.22814
G1 X103.956 Y71.342 E.01647
G1 X108.658 Y76.044 E.20484
G1 X108.658 Y75.51 E.01647
G1 X104.49 Y71.342 E.18155
G1 X105.025 Y71.342 E.01647
G1 X108.658 Y74.975 E.15826
G1 X108.658 Y74.441 E.01647
G1 X105.56 Y71.342 E.13497
G1 X106.094 Y71.342 E.01647
G1 X108.658 Y73.906 E.11168
G1 X108.658 Y73.371 E.01647
G1 X106.629 Y71.342 E.08839
G1 X107.163 Y71.342 E.01647
G1 X108.658 Y72.837 E.0651
G1 X108.658 Y72.302 E.01647
G1 X107.698 Y71.342 E.04181
G1 X108.233 Y71.342 E.01647
G1 X108.827 Y71.937 E.02591
; CHANGE_LAYER
; Z_HEIGHT: 40
; LAYER_HEIGHT: 0.200001
; WIPE_START
G1 F9522.802
G1 X108.233 Y71.342 E-.31956
G1 X107.698 Y71.342 E-.20316
G1 X108.14 Y71.784 E-.23728
; WIPE_END
G1 E-.04 F1800
; layer num/total_layer_count: 200/200
; update layer progress
M73 L200
M991 S0 P199 ;notify layer change
; OBJECT_ID: 15
M204 S10000
G17
G3 Z40.2 I-1.216 J.053 P1  F42000
G1 X109.79 Y109.79 Z40.2
G1 Z40
M73 P97 R0
G1 E.8 F1800
; FEATURE: Outer wall
; LINE_WIDTH: 0.42
G1 F9547.055
M204 S5000
G1 X70.21 Y109.79 E1.21618
G1 X70.21 Y70.21 E1.21618
G1 X109.79 Y70.21 E1.21618
G1 X109.79 Y109.73 E1.21434
; WIPE_START
M204 S6000
G1 X107.79 Y109.733 E-.76
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z40.4 I1.217 J0 P1  F42000
;========Date 20250206========
M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
 ; timelapse without wipe tower
M971 S11 C10 O0

M623

G1 X109.583 Y109.078
G1 Z40
G1 E.8 F1800
; FEATURE: Top surface
G1 F9547.055
M204 S2000
G1 X109.078 Y109.583 E.02191
G1 X108.545 Y109.583
G1 X109.583 Y108.545 E.04508
G1 X109.583 Y108.012
G1 X108.012 Y109.583 E.06825
G1 X107.479 Y109.583
G1 X109.583 Y107.479 E.09143
G1 X109.583 Y106.945
G1 X106.945 Y109.583 E.1146
G1 X106.412 Y109.583
G1 X109.583 Y106.412 E.13777
G1 X109.583 Y105.879
G1 X105.879 Y109.583 E.16094
G1 X105.346 Y109.583
G1 X109.583 Y105.346 E.18412
G1 X109.583 Y104.812
G1 X104.812 Y109.583 E.20729
G1 X104.279 Y109.583
G1 X109.583 Y104.279 E.23046
G1 X109.583 Y103.746
G1 X103.746 Y109.583 E.25363
G1 X103.213 Y109.583
G1 X109.583 Y103.213 E.27681
G1 X109.583 Y102.679
G1 X102.679 Y109.583 E.29998
G1 X102.146 Y109.583
G1 X109.583 Y102.146 E.32315
G1 X109.583 Y101.613
G1 X101.613 Y109.583 E.34633
G1 X101.08 Y109.583
G1 X109.583 Y101.08 E.3695
G1 X109.583 Y100.546
G1 X100.546 Y109.583 E.39267
G1 X100.013 Y109.583
G1 X109.583 Y100.013 E.41584
G1 X109.583 Y99.48
G1 X99.48 Y109.583 E.43902
G1 X98.947 Y109.583
G1 X109.583 Y98.947 E.46219
G1 X109.583 Y98.413
G1 X98.413 Y109.583 E.48536
G1 X97.88 Y109.583
G1 X109.583 Y97.88 E.50853
G1 X109.583 Y97.347
G1 X97.347 Y109.583 E.53171
G1 X96.814 Y109.583
G1 X109.583 Y96.814 E.55488
G1 X109.583 Y96.28
G1 X96.28 Y109.583 E.57805
G1 X95.747 Y109.583
G1 X109.583 Y95.747 E.60122
G1 X109.583 Y95.214
G1 X95.214 Y109.583 E.6244
G1 X94.681 Y109.583
G1 X109.583 Y94.681 E.64757
G1 X109.583 Y94.147
G1 X94.147 Y109.583 E.67074
G1 X93.614 Y109.583
G1 X109.583 Y93.614 E.69391
G1 X109.583 Y93.081
G1 X93.081 Y109.583 E.71709
G1 X92.547 Y109.583
G1 X109.583 Y92.547 E.74026
G1 X109.583 Y92.014
G1 X92.014 Y109.583 E.76343
G1 X91.481 Y109.583
G1 X109.583 Y91.481 E.78661
G1 X109.583 Y90.948
G1 X90.948 Y109.583 E.80978
G1 X90.414 Y109.583
G1 X109.583 Y90.414 E.83295
G1 X109.583 Y89.881
G1 X89.881 Y109.583 E.85612
G1 X89.348 Y109.583
G1 X109.583 Y89.348 E.8793
G1 X109.583 Y88.815
G1 X88.815 Y109.583 E.90247
G1 X88.281 Y109.583
G1 X109.583 Y88.281 E.92564
G1 X109.583 Y87.748
G1 X87.748 Y109.583 E.94881
G1 X87.215 Y109.583
G1 X109.583 Y87.215 E.97199
G1 X109.583 Y86.682
G1 X86.682 Y109.583 E.99516
G1 X86.148 Y109.583
G1 X109.583 Y86.148 E1.01833
G1 X109.583 Y85.615
G1 X85.615 Y109.583 E1.0415
G1 X85.082 Y109.583
G1 X109.583 Y85.082 E1.06468
G1 X109.583 Y84.549
G1 X84.549 Y109.583 E1.08785
G1 X84.015 Y109.583
G1 X109.583 Y84.015 E1.11102
G1 X109.583 Y83.482
G1 X83.482 Y109.583 E1.13419
G1 X82.949 Y109.583
G1 X109.583 Y82.949 E1.15737
G1 X109.583 Y82.416
G1 X82.416 Y109.583 E1.18054
G1 X81.882 Y109.583
G1 X109.583 Y81.882 E1.20371
G1 X109.583 Y81.349
G1 X81.349 Y109.583 E1.22689
G1 X80.816 Y109.583
G1 X109.583 Y80.816 E1.25006
G1 X109.583 Y80.283
G1 X80.283 Y109.583 E1.27323
G1 X79.749 Y109.583
G1 X109.583 Y79.749 E1.2964
G1 X109.583 Y79.216
G1 X79.216 Y109.583 E1.31958
G1 X78.683 Y109.583
G1 X109.583 Y78.683 E1.34275
G1 X109.583 Y78.15
M73 P98 R0
G1 X78.15 Y109.583 E1.36592
G1 X77.616 Y109.583
G1 X109.583 Y77.616 E1.38909
G1 X109.583 Y77.083
G1 X77.083 Y109.583 E1.41227
G1 X76.55 Y109.583
G1 X109.583 Y76.55 E1.43544
G1 X109.583 Y76.017
G1 X76.016 Y109.583 E1.45861
G1 X75.483 Y109.583
G1 X109.583 Y75.483 E1.48178
G1 X109.583 Y74.95
G1 X74.95 Y109.583 E1.50496
G1 X74.417 Y109.583
G1 X109.583 Y74.417 E1.52813
G1 X109.583 Y73.883
G1 X73.883 Y109.583 E1.5513
G1 X73.35 Y109.583
G1 X109.583 Y73.35 E1.57447
G1 X109.583 Y72.817
G1 X72.817 Y109.583 E1.59765
G1 X72.284 Y109.583
G1 X109.583 Y72.284 E1.62082
G1 X109.583 Y71.75
G1 X71.75 Y109.583 E1.64399
G1 X71.217 Y109.583
G1 X109.583 Y71.217 E1.66716
G1 X109.583 Y70.684
G1 X70.684 Y109.583 E1.69034
G1 X70.417 Y109.316
G1 X109.316 Y70.417 E1.69033
G1 X108.783 Y70.417
G1 X70.417 Y108.783 E1.66716
G1 X70.417 Y108.249
G1 X108.249 Y70.417 E1.64398
G1 X107.716 Y70.417
G1 X70.417 Y107.716 E1.62081
G1 X70.417 Y107.183
G1 X107.183 Y70.417 E1.59764
G1 X106.65 Y70.417
G1 X70.417 Y106.65 E1.57447
G1 X70.417 Y106.116
G1 X106.116 Y70.417 E1.55129
G1 X105.583 Y70.417
G1 X70.417 Y105.583 E1.52812
G1 X70.417 Y105.05
G1 X105.05 Y70.417 E1.50495
G1 X104.517 Y70.417
G1 X70.417 Y104.517 E1.48178
G1 X70.417 Y103.983
G1 X103.983 Y70.417 E1.4586
G1 X103.45 Y70.417
G1 X70.417 Y103.45 E1.43543
G1 X70.417 Y102.917
G1 X102.917 Y70.417 E1.41226
G1 X102.384 Y70.417
G1 X70.417 Y102.384 E1.38909
G1 X70.417 Y101.85
G1 X101.85 Y70.417 E1.36591
G1 X101.317 Y70.417
G1 X70.417 Y101.317 E1.34274
G1 X70.417 Y100.784
G1 X100.784 Y70.417 E1.31957
G1 X100.251 Y70.417
G1 X70.417 Y100.251 E1.2964
G1 X70.417 Y99.717
G1 X99.717 Y70.417 E1.27322
G1 X99.184 Y70.417
G1 X70.417 Y99.184 E1.25005
G1 X70.417 Y98.651
G1 X98.651 Y70.417 E1.22688
G1 X98.118 Y70.417
G1 X70.417 Y98.118 E1.20371
G1 X70.417 Y97.584
G1 X97.584 Y70.417 E1.18053
G1 X97.051 Y70.417
G1 X70.417 Y97.051 E1.15736
G1 X70.417 Y96.518
G1 X96.518 Y70.417 E1.13419
G1 X95.985 Y70.417
G1 X70.417 Y95.984 E1.11101
G1 X70.417 Y95.451
G1 X95.451 Y70.417 E1.08784
G1 X94.918 Y70.417
G1 X70.417 Y94.918 E1.06467
G1 X70.417 Y94.385
G1 X94.385 Y70.417 E1.0415
G1 X93.851 Y70.417
G1 X70.417 Y93.851 E1.01832
G1 X70.417 Y93.318
G1 X93.318 Y70.417 E.99515
G1 X92.785 Y70.417
G1 X70.417 Y92.785 E.97198
G1 X70.417 Y92.252
G1 X92.252 Y70.417 E.94881
G1 X91.718 Y70.417
G1 X70.417 Y91.718 E.92563
G1 X70.417 Y91.185
G1 X91.185 Y70.417 E.90246
G1 X90.652 Y70.417
G1 X70.417 Y90.652 E.87929
G1 X70.417 Y90.119
G1 X90.119 Y70.417 E.85612
G1 X89.585 Y70.417
G1 X70.417 Y89.585 E.83294
G1 X70.417 Y89.052
G1 X89.052 Y70.417 E.80977
G1 X88.519 Y70.417
G1 X70.417 Y88.519 E.7866
G1 X70.417 Y87.986
G1 X87.986 Y70.417 E.76343
M73 P99 R0
G1 X87.452 Y70.417
G1 X70.417 Y87.452 E.74025
G1 X70.417 Y86.919
G1 X86.919 Y70.417 E.71708
G1 X86.386 Y70.417
G1 X70.417 Y86.386 E.69391
G1 X70.417 Y85.853
G1 X85.853 Y70.417 E.67073
G1 X85.319 Y70.417
G1 X70.417 Y85.319 E.64756
G1 X70.417 Y84.786
G1 X84.786 Y70.417 E.62439
G1 X84.253 Y70.417
G1 X70.417 Y84.253 E.60122
G1 X70.417 Y83.72
G1 X83.72 Y70.417 E.57804
G1 X83.186 Y70.417
G1 X70.417 Y83.186 E.55487
G1 X70.417 Y82.653
G1 X82.653 Y70.417 E.5317
G1 X82.12 Y70.417
G1 X70.417 Y82.12 E.50853
G1 X70.417 Y81.587
G1 X81.587 Y70.417 E.48535
G1 X81.053 Y70.417
G1 X70.417 Y81.053 E.46218
G1 X70.417 Y80.52
G1 X80.52 Y70.417 E.43901
G1 X79.987 Y70.417
G1 X70.417 Y79.987 E.41584
G1 X70.417 Y79.454
G1 X79.454 Y70.417 E.39266
G1 X78.92 Y70.417
G1 X70.417 Y78.92 E.36949
G1 X70.417 Y78.387
G1 X78.387 Y70.417 E.34632
G1 X77.854 Y70.417
G1 X70.417 Y77.854 E.32315
G1 X70.417 Y77.32
G1 X77.32 Y70.417 E.29997
G1 X76.787 Y70.417
G1 X70.417 Y76.787 E.2768
G1 X70.417 Y76.254
G1 X76.254 Y70.417 E.25363
G1 X75.721 Y70.417
G1 X70.417 Y75.721 E.23045
G1 X70.417 Y75.187
G1 X75.187 Y70.417 E.20728
G1 X74.654 Y70.417
G1 X70.417 Y74.654 E.18411
G1 X70.417 Y74.121
G1 X74.121 Y70.417 E.16094
G1 X73.588 Y70.417
G1 X70.417 Y73.588 E.13776
G1 X70.417 Y73.054
G1 X73.054 Y70.417 E.11459
G1 X72.521 Y70.417
G1 X70.417 Y72.521 E.09142
G1 X70.417 Y71.988
G1 X71.988 Y70.417 E.06825
G1 X71.455 Y70.417
G1 X70.417 Y71.455 E.04507
G1 X70.417 Y70.921
G1 X70.921 Y70.417 E.0219
; close powerlost recovery
M1003 S0
; WIPE_START
G1 F9547.055
M204 S6000
G1 X70.417 Y70.921 E-.27085
G1 X70.417 Y71.455 E-.20264
G1 X70.951 Y70.922 E-.28651
; WIPE_END
G1 E-.04 F1800
M204 S10000
G17
G3 Z40.4 I1.217 J0 P1  F42000
M106 S0
M981 S0 P20000 ; close spaghetti detector
; FEATURE: Custom
; MACHINE_END_GCODE_START
; filament end gcode 

;===== date: 20230428 =====================
M400 ; wait for buffer to clear
G92 E0 ; zero the extruder
G1 E-0.8 F1800 ; retract
G1 Z40.5 F900 ; lower z a little
G1 X65 Y245 F12000 ; move to safe pos 
G1 Y265 F3000

G1 X65 Y245 F12000
G1 Y265 F3000
M140 S0 ; turn off bed
M106 S0 ; turn off fan
M106 P2 S0 ; turn off remote part cooling fan
M106 P3 S0 ; turn off chamber cooling fan

G1 X100 F12000 ; wipe
; pull back filament to AMS
M620 S255
G1 X20 Y50 F12000
G1 Y-3
T255
G1 X65 F12000
G1 Y265
G1 X100 F12000 ; wipe
M621 S255
M104 S0 ; turn off hotend

M622.1 S1 ; for prev firmware, default turned on
M1002 judge_flag timelapse_record_flag
M622 J1
    M400 ; wait all motion done
    M991 S0 P-1 ;end smooth timelapse at safe pos
    M400 S3 ;wait for last picture to be taken
M623; end of "timelapse_record_flag"

M400 ; wait all motion done
M17 S
M17 Z0.4 ; lower z motor current to reduce impact if there is something in the bottom

    G1 Z140 F600
    G1 Z138

M400 P100
M17 R ; restore z current

G90
G1 X128 Y250 F3600

M220 S100  ; Reset feedrate magnitude
M201.2 K1.0 ; Reset acc magnitude
M73.2   R1.0 ;Reset left time magnitude
M1002 set_gcode_claim_speed_level : 0

M17 X0.8 Y0.8 Z0.5 ; lower motor current to 45% power
M73 P100 R0
; EXECUTABLE_BLOCK_END

