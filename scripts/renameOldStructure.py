import base64
import os
import argparse
import json
from typing import Dict, List, Union
import time

class FileInfo:
    def __init__ (self, title: str, ordering: int):
        self.title = title
        self.ordering = ordering
    def __str__ (self):
        return f"[ FileInfo: title='{self.title}', ordering={self.ordering} ]"
    
    def insert_json (self, d: Dict[str, Union[str, int]]): 
        d['ordering'] = self.ordering
        d['title'] = self.title

class ConfigFile:
    def __init__ (self, config_path: str):
        self.parent = os.path.dirname(config_path)
        self.config_path = config_path
        self.file_info: Dict[str, FileInfo] = {}
    
    def add_config (self, filename: str, title: str, ordering: int):
        self.file_info[filename] = FileInfo(title=title, ordering=ordering)

    def perform_rename (self):
        new_configs: Dict[str, FileInfo] = {}
        json_config: Dict[str, Dict[str, Union[str, int]]] = {}
        for fn, cfg in self.file_info.items():
            ft = fn.split('-')[0]
            ext = '.wt' if fn.endswith('.wt') else ''
            ts = time.time_ns()
            tshex = hex(ts)[2:]
            newname = f'{ft}-{tshex}{ext}'

            full_old = os.path.join(self.parent, fn)
            full_new = os.path.join(self.parent, newname)
            os.rename(full_old, full_new)
            new_configs[newname] = cfg

            json_config[newname] = {}
            cfg.insert_json(json_config[newname])

            time.sleep(0.01)
        
        self.file_info = new_configs
        with open(self.config_path, 'w') as f:
            print(json_config)
            json.dump(json_config, f)

        print(str(self))

    
    def __str__ (self):
        ret = f'{self.config_path}: {{\n'
        for key, val in self.file_info.items():
            ret += f"    {key} = {str(val)}\n"
        ret += "}"
        return ret
    
    def child_dirs (self) -> List[str]:
        lst = []
        fns = list(self.file_info.keys())
        fns.append('snips')
        for filename in fns:
            pth = os.path.join(self.parent, filename)
            if os.path.exists(pth) and os.path.isdir(pth):
                lst.append(pth)
        return lst


def read_config(path: str) -> Union[None, ConfigFile]:
    '''
    { 
        [fileName]: {
            title: string,
            ordering: number
        }
    }
    '''
    config_path = os.path.join(path, '.config')
    if not (os.path.exists(config_path) and os.path.isfile(config_path)):
        return None
    
    config_obj = ConfigFile(config_path=config_path)
    with open(config_path, 'r') as f:
        config: Dict[str, Dict[str, Union[str, int]]] = json.load(f)

        for key, val in config.items():
            title = val['title']
            ordering = val['ordering']
            if type(title) != str or type(ordering) != int:
                continue
            config_obj.add_config(key, title=title, ordering=ordering)
    return config_obj




def analyze_workspace (root: str):
    chapters_dir = os.path.join(root, 'data', 'chapters')
    snips_dir = os.path.join(root, 'data', 'snips')

    configs: List[ConfigFile] = []
    q: List[str] = [ chapters_dir, snips_dir ]
    while len(q) != 0:
        cfg = read_config(q.pop())
        if cfg is None: continue

        cfg.perform_rename()

        configs.append(cfg)
        next = cfg.child_dirs()
        q.extend(next)

    

if __name__ == '__main__':
    parser = argparse.ArgumentParser("renameOldStructure.py")
    parser.add_argument("path", type=str)
    args = parser.parse_args()

    root = args.path
    analyze_workspace(root)
    
    
