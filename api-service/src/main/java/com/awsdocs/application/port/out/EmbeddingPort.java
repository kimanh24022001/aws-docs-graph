package com.awsdocs.application.port.out;

import java.util.List;

public interface EmbeddingPort {
  List<Double> embed(String text);
}
