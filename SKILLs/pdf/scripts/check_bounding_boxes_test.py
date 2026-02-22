import unittest
import json
import io
from check_bounding_boxes import get_bounding_box_messages


# 目前这不会在CI中自动运行；仅用于文档和手动检查。
class TestGetBoundingBoxMessages(unittest.TestCase):
    
    def create_json_stream(self, data):
        """辅助方法：从数据创建JSON流"""
        return io.StringIO(json.dumps(data))
    
    def test_no_intersections(self):
        """测试用例：没有边界框相交"""
        data = {
            "form_fields": [
                {
                    "description": "Name",
                    "page_number": 1,
                    "label_bounding_box": [10, 10, 50, 30],
                    "entry_bounding_box": [60, 10, 150, 30]
                },
                {
                    "description": "Email",
                    "page_number": 1,
                    "label_bounding_box": [10, 40, 50, 60],
                    "entry_bounding_box": [60, 40, 150, 60]
                }
            ]
        }
        
        stream = self.create_json_stream(data)
        messages = get_bounding_box_messages(stream)
        self.assertTrue(any("SUCCESS" in msg for msg in messages))
        self.assertFalse(any("FAILURE" in msg for msg in messages))
    
    def test_label_entry_intersection_same_field(self):
        """测试同一字段的标签和输入框之间的相交"""
        data = {
            "form_fields": [
                {
                    "description": "Name",
                    "page_number": 1,
                    "label_bounding_box": [10, 10, 60, 30],
                    "entry_bounding_box": [50, 10, 150, 30]  # 与标签重叠
                }
            ]
        }
        
        stream = self.create_json_stream(data)
        messages = get_bounding_box_messages(stream)
        self.assertTrue(any("FAILURE" in msg and "intersection" in msg for msg in messages))
        self.assertFalse(any("SUCCESS" in msg for msg in messages))
    
    def test_intersection_between_different_fields(self):
        """测试不同字段边界框之间的相交"""
        data = {
            "form_fields": [
                {
                    "description": "Name",
                    "page_number": 1,
                    "label_bounding_box": [10, 10, 50, 30],
                    "entry_bounding_box": [60, 10, 150, 30]
                },
                {
                    "description": "Email",
                    "page_number": 1,
                    "label_bounding_box": [40, 20, 80, 40],  # 与Name的框重叠
                    "entry_bounding_box": [160, 10, 250, 30]
                }
            ]
        }
        
        stream = self.create_json_stream(data)
        messages = get_bounding_box_messages(stream)
        self.assertTrue(any("FAILURE" in msg and "intersection" in msg for msg in messages))
        self.assertFalse(any("SUCCESS" in msg for msg in messages))
    
    def test_different_pages_no_intersection(self):
        """测试不同页面上的框不计为相交"""
        data = {
            "form_fields": [
                {
                    "description": "Name",
                    "page_number": 1,
                    "label_bounding_box": [10, 10, 50, 30],
                    "entry_bounding_box": [60, 10, 150, 30]
                },
                {
                    "description": "Email",
                    "page_number": 2,
                    "label_bounding_box": [10, 10, 50, 30],  # 相同坐标但不同页面
                    "entry_bounding_box": [60, 10, 150, 30]
                }
            ]
        }
        
        stream = self.create_json_stream(data)
        messages = get_bounding_box_messages(stream)
        self.assertTrue(any("SUCCESS" in msg for msg in messages))
        self.assertFalse(any("FAILURE" in msg for msg in messages))
    
    def test_entry_height_too_small(self):
        """测试输入框高度是否根据字体大小进行检查"""
        data = {
            "form_fields": [
                {
                    "description": "Name",
                    "page_number": 1,
                    "label_bounding_box": [10, 10, 50, 30],
                    "entry_bounding_box": [60, 10, 150, 20],  # 高度为10
                    "entry_text": {
                        "font_size": 14  # 字体大小大于高度
                    }
                }
            ]
        }
        
        stream = self.create_json_stream(data)
        messages = get_bounding_box_messages(stream)
        self.assertTrue(any("FAILURE" in msg and "height" in msg for msg in messages))
        self.assertFalse(any("SUCCESS" in msg for msg in messages))
    
    def test_entry_height_adequate(self):
        """测试足够的输入框高度通过检查"""
        data = {
            "form_fields": [
                {
                    "description": "Name",
                    "page_number": 1,
                    "label_bounding_box": [10, 10, 50, 30],
                    "entry_bounding_box": [60, 10, 150, 30],  # 高度为20
                    "entry_text": {
                        "font_size": 14  # 字体大小小于高度
                    }
                }
            ]
        }
        
        stream = self.create_json_stream(data)
        messages = get_bounding_box_messages(stream)
        self.assertTrue(any("SUCCESS" in msg for msg in messages))
        self.assertFalse(any("FAILURE" in msg for msg in messages))
    
    def test_default_font_size(self):
        """测试未指定时使用默认字体大小"""
        data = {
            "form_fields": [
                {
                    "description": "Name",
                    "page_number": 1,
                    "label_bounding_box": [10, 10, 50, 30],
                    "entry_bounding_box": [60, 10, 150, 20],  # 高度为10
                    "entry_text": {}  # 未指定font_size，应使用默认值14
                }
            ]
        }
        
        stream = self.create_json_stream(data)
        messages = get_bounding_box_messages(stream)
        self.assertTrue(any("FAILURE" in msg and "height" in msg for msg in messages))
        self.assertFalse(any("SUCCESS" in msg for msg in messages))
    
    def test_no_entry_text(self):
        """测试缺少entry_text不会导致高度检查"""
        data = {
            "form_fields": [
                {
                    "description": "Name",
                    "page_number": 1,
                    "label_bounding_box": [10, 10, 50, 30],
                    "entry_bounding_box": [60, 10, 150, 20]  # 小高度但没有entry_text
                }
            ]
        }
        
        stream = self.create_json_stream(data)
        messages = get_bounding_box_messages(stream)
        self.assertTrue(any("SUCCESS" in msg for msg in messages))
        self.assertFalse(any("FAILURE" in msg for msg in messages))
    
    def test_multiple_errors_limit(self):
        """测试错误消息数量限制以防止过多输出"""
        fields = []
        # 创建许多重叠的字段
        for i in range(25):
            fields.append({
                "description": f"Field{i}",
                "page_number": 1,
                "label_bounding_box": [10, 10, 50, 30],  # 全部重叠
                "entry_bounding_box": [20, 15, 60, 35]   # 全部重叠
            })
        
        data = {"form_fields": fields}
        
        stream = self.create_json_stream(data)
        messages = get_bounding_box_messages(stream)
        # 应该在约20条消息后中止
        self.assertTrue(any("Aborting" in msg for msg in messages))
        # 应该有一些FAILURE消息但不会太多
        failure_count = sum(1 for msg in messages if "FAILURE" in msg)
        self.assertGreater(failure_count, 0)
        self.assertLess(len(messages), 30)  # 应该被限制
    
    def test_edge_touching_boxes(self):
        """测试边缘相接的框不计为相交"""
        data = {
            "form_fields": [
                {
                    "description": "Name",
                    "page_number": 1,
                    "label_bounding_box": [10, 10, 50, 30],
                    "entry_bounding_box": [50, 10, 150, 30]  # 在x=50处相接
                }
            ]
        }
        
        stream = self.create_json_stream(data)
        messages = get_bounding_box_messages(stream)
        self.assertTrue(any("SUCCESS" in msg for msg in messages))
        self.assertFalse(any("FAILURE" in msg for msg in messages))
    

if __name__ == '__main__':
    unittest.main()
